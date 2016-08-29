import {RTM_MESSAGE_SUBTYPES} from '@slack/client';
import {isNil, isNull} from 'lodash';
import moment from 'moment';
import {Order} from './models';
import {slack, orders} from './resources';
import {prettyPrint, stripMention} from './utils';
import config from '../config'; // eslint-disable-line import/no-unresolved

// #obedbot-testing id - 'G1TT0TBAA'
//const channelId = 'G1TT0TBAA';
const channelId = config.slack.channelId;
const botUserId = config.slack.botId;
const atObedbot = new RegExp(`<@${botUserId}>`);
const reactions = ['jedlopodnos', 'corn', 'spaghetti', 'shopping_bags'];

/*
 * orders are of form {ts: 'string with timestamp, order: 'string with order'}
 */
let veglife = orders.veglife;
let jpn = orders.jedloPodNos;
let spaghetti = orders.spaghetti;
let nakup = orders.nakup;

// ts = timestamp
let lastCall = {ts: null, timeLeft: null};
const lastCallLength = config.lastCall.length;
const lastCallStep = config.lastCall.step;

const rtm = slack.rtm;
const web = slack.web;


/**
 * Checks the incoming order and assigns it to the correct restaurant
 *
 * @param {string} order - order message
 * @param {string} ts - timestamp of the order message
 * @returns {bool} - true if order matches, false if not identified
 */
export function processOrder(order, ts) {
  order = order.toLowerCase().trim();
  console.log('Processing order:', order);

  if (order.match(/^veg[1-4]\+?[ps]?/)) {
    console.log('Veglife', order);
    veglife.push({ts: ts, text: order});
  } else if (order.match(/^[1-8]\+[psk]/)) {
    console.log('Jedlo pod nos');
    jpn.push({ts: ts, text: order});
  } else if (order.match(/^[a-z]((300)|(400)|(450)|(600)|(800))([psc]{1,2})?\+?[pt]?/)) {
    console.log('Spaghetti');
    spaghetti.push({ts: ts, text: order});
  } else if (order.match(/^nakup/)) {
    console.log('Nakup', order.substring(6));
    nakup.push({ts: ts, text: order.substring(6)});
  } else {
    console.log('ziadna restika, plany poplach');
    return false;
  }

  return true;
}

/**
 * Updates the order with the given ts to newOrder
 *
 * @param {string} newOrder - new order message
 * @param {string} ts - timestamp of the order message
 * @returns {bool} - true if order with supplied ts is found, false otherwise
 */
export function updateOrder(newOrder, ts) {
  const orders = [...jpn, ...veglife, ...spaghetti, ...nakup];

  for (let order of orders) {
    if (order.ts === ts) {
      order.text = newOrder;
      return true;
    }
  }

  return false;
}

/**
 * Removes the order with the given ts
 *
 * @param {string} ts - timestamp of the order message
 * @returns {bool} - true if order with supplied ts is deleted, false otherwise
 */
export function removeOrder(ts) {
  const restaurants = [jpn, veglife, spaghetti, nakup];

  for (let restaurant of restaurants) {
    for (let order in restaurant) {
      if (restaurant[order].ts === ts) {
        restaurant.splice(order, 1);
        return true;
      }
    }
  }

  return false;
}

/**
 * Adds reaction to the message to confirm the order
 *
 * @param {string} ts - timestamp of the order message
 *
 */

export function confirmOrder(ts) {
  // key of the object is the reaction to the order on slack
  // reactions are custom/aliases of slack reactions
  const restaurants = {
    jedlopodnos: jpn,
    veglife: veglife,
    spaghetti: spaghetti,
    nakup: nakup,
  };

  for (let key in restaurants) {
    if (restaurants.hasOwnProperty(key)) {
      for (let order of restaurants[key]) {
        if (order.ts === ts) {
          web.reactions.add(key, {channel: channelId, timestamp: ts});
        }
      }
    }
  }
}

/**
 * Checks whether the order with given timestamp exists
 *
 * @param {string} ts - timestamp of the order
 * @returns {bool} - true if order exists, false otherwise
 */

export function orderExists(ts) {
  const orders = [...jpn, ...veglife, ...spaghetti, ...nakup];

  for (let order of orders) {
    if (order.ts === ts) {
      return true;
    }
  }

  return false;
}

/**
 * Deletes and archives all the orders
 */

export function dropOrders() {
  for (let restaurant in orders) {
    if (orders.hasOwnProperty(restaurant)) {
      orders[restaurant].length = 0;
    }
  }
}

/**
 * Function called by slack api after receiving message event
 *
 * @param {Object} res - response slack api received
 *
 */

export function messageReceived(res) {
  console.log('Message Arrived:\n', prettyPrint(res));

  if (isNil(res.subtype)) {
    let order = res.text;

    if (order.match(atObedbot)) {
      order = stripMention(order);

      if (processOrder(order.toLowerCase(), res.ts)) {
        confirmOrder(res.ts);
      }
    }
  } else if (res.subtype === RTM_MESSAGE_SUBTYPES.MESSAGE_CHANGED) {
    console.log('Received an edited message');

    // edited last call message came in
    if (!isNull(lastCall.ts) && res.previous_message.ts === lastCall.ts) {
      console.log('Received last call message edited by obedbot.');
    } else {
      console.log('Received edited message.');
      let order = res.message.text;

      if (order.match(atObedbot)) {
        order = stripMention(order);

        if (updateOrder(order, res.message.ts)) {
          console.log('Updated some order.');
        } else {
          console.log('Order with such id does not exist.');

          if (processOrder(order.toLowerCase(), res.message.ts)) {
            confirmOrder(res.message.ts);
          }
        }
      }
    }
  } else if (res.subtype === RTM_MESSAGE_SUBTYPES.MESSAGE_DELETED) {
    console.log('Deleting order:', res.previous_message.text);
    removeOrder(res.previous_message.ts);
  }
}

/**
 * Loads the orders since the last noon
 */

export function loadTodayOrders() {
  console.log('Loading today\'s orders from', channelId);

  let lastNoon = moment();
  let now = moment();

  // set the date to last Friday if it is Saturday (6), Sunday (0) or Monday (1)
  if (now.day() === 0 || now.day() === 1 || now.day() === 6) {
    lastNoon.day(-2);
  } else if (now.hours() < 12) {
    lastNoon.subtract(1, 'day');
  }

  lastNoon.hours(12);
  lastNoon.minutes(0);
  lastNoon.seconds(0);

  let messages = web.channels.history(
    channelId,
    {
      latest: now.valueOf() / 1000,
      oldest: lastNoon.valueOf() / 1000,
    }
  ).then((data) => {
    for (let message of data.messages) {
      console.log(prettyPrint(message));

      let order = message.text;
      Order.find({timestamp: message.ts}).exec().then((results) => {
        console.log('I am in then', results);
        if (!results.length) {
          console.log('order does not exist in db');
          new Order({timestamp: message.ts, text: order, userId: message.user}).save();
        }
      }).catch((err) => {
        console.log('I got caught', err);
      });
      if (false) {
        if (order.match(atObedbot)) {
          order = stripMention(order);

          if (processOrder(order.toLowerCase(), message.ts)) {
            web.reactions.get(
              {
                channel: channelId,
                timestamp: message.ts,
                full: true,
              }
            ).then((res) => {
              console.log('Checking order confirmation:', prettyPrint(res));

              if (isNil(res.message.reactions)) {
                confirmOrder(res.message.ts);
              } else {
                console.log('Reactions:', prettyPrint(res.message.reactions));

                // if order hasn't been confirmed
                if (res.message.reactions.filter((r) => reactions.indexOf(r.name) > -1).length === 0) {
                  confirmOrder(res.message.ts);
                }
              }
            });
          }
        }
      }
    }
    console.log('Loaded today\'s orders');
  });
  console.log('messages', messages);
}

/**
 * Makes the last call for orders
 */
export function makeLastCall(restaurant) {
  if (isNull(lastCall.ts)) {
    // no last call ongoing, start one
    lastCall.timeLeft = lastCallLength;
    rtm.sendMessage(`@channel Last call ${restaurant}: ${lastCall.timeLeft}`, channelId,
      (err, msg) => {
        if (err) {
          console.error(err);
        }
        console.log('Sent last call message', err, msg);

        lastCall.ts = msg.ts;
        lastCall.timeLeft = lastCallLength;

        setTimeout(() => {makeLastCall(restaurant);}, lastCallStep * 1000);
      }
    );
  } else if (lastCall.timeLeft > 0 && lastCall.timeLeft <= lastCallLength) {
    // last call ongoing, update it
    lastCall.timeLeft -= lastCallStep;

    web.chat.update(lastCall.ts, channelId, `@channel Last call ${restaurant}: ${lastCall.timeLeft}`);

    setTimeout(() => {makeLastCall(restaurant);}, lastCallStep * 1000);
  } else if (lastCall.timeLeft <= 0) {
    // end of last call
    web.chat.update(lastCall.ts, channelId, '@channel Koniec objednavok ' + restaurant);

    lastCall.timeLeft = null;
    lastCall.ts = null;
  } else {
    console.log('This should not happen');
  }
}
