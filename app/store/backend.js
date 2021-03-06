/**
 * Copyright (c) 2014-present PlatformIO <contact@platformio.org>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { put, take } from 'redux-saga/effects';

import { createAction } from './actions';
import jsonrpc from 'jsonrpc-lite';
import { message } from 'antd';

export const actions = {
  BACKEND_CONNECTED: 'BACKEND_CONNECTED',
  BACKEND_DISCONNECTED: 'BACKEND_DISCONNECTED',
  BACKEND_ERRORED: 'BACKEND_ERRORED',
  BACKEND_REQUEST: 'BACKEND_REQUEST',
  BACKEND_RESULT_SUCCESS: 'BACKEND_RESULT_SUCCESS',
  BACKEND_RESULT_ERROR: 'BACKEND_RESULT_ERROR',
};

actions.backendRequest = (id, query, params) =>
  createAction(actions.BACKEND_REQUEST, {
    id,
    query,
    params,
  });

export function* backendFetchData({ query, params = [] }) {
  const id = Math.random().toString();
  yield put(actions.backendRequest(id, query, params));
  /* eslint-disable no-constant-condition */
  while (true) {
    const action = yield take([
      actions.BACKEND_RESULT_SUCCESS,
      actions.BACKEND_RESULT_ERROR,
    ]);
    if (action.id !== id) {
      continue;
    }
    if (action.type === actions.BACKEND_RESULT_ERROR) {
      throw action.error;
    }
    return action.result;
  }
}

export function backendMiddleware(options) {
  return (store) => {
    let socket = null;
    let messageQueue = [];
    const reconnect = {
      timer: null,
      loading: null,
      delay: 500, // msec
      maxDelay: 10000, // msec
      retries: 0,
    };

    function newSocket(endpoint) {
      if (reconnect.timer) {
        clearTimeout(reconnect.timer);
      }
      let sock = null;
      try {
        sock = new WebSocket(endpoint);
      } catch (err) {
        return message.error(
          'Communication Error: This browser does not support WebSocket protocol',
          0
        );
      }

      sock.onopen = () => {
        reconnect.retries = 0;
        if (reconnect.loading) {
          reconnect.loading();
        }

        store.dispatch(createAction(actions.BACKEND_CONNECTED));
        const _messageQueue = messageQueue.slice(0);
        messageQueue = []; // reset messageQueue
        _messageQueue.forEach((data) => sock.send(data));
      };

      sock.onclose = () => {
        store.dispatch(createAction(actions.BACKEND_DISCONNECTED));
        // reconnect
        if (!reconnect.loading) {
          reconnect.loading = message.loading('Reconnecting...', 0);
        }

        reconnect.retries++;
        reconnect.interval = setTimeout(
          () => (socket = newSocket(endpoint)),
          Math.min(reconnect.delay * reconnect.retries, reconnect.maxDelay)
        );
      };

      sock.onmessage = (event) => {
        try {
          const result = jsonrpc.parse(event.data);
          switch (result.type) {
            case 'success':
              return store.dispatch(
                createAction(actions.BACKEND_RESULT_SUCCESS, result.payload)
              );
            case 'error':
              return store.dispatch(
                createAction(actions.BACKEND_RESULT_ERROR, result.payload)
              );
          }
        } catch (err) {
          store.dispatch(createAction(actions.BACKEND_ERRORED, err));
        }
      };
      return sock;
    }

    socket = newSocket(options.endpoint);
    if (!socket) {
      return undefined;
    }
    return (next) => (action) => {
      if (action && action.type === actions.BACKEND_REQUEST) {
        const msg = JSON.stringify(
          jsonrpc.request(action.id, action.query, action.params)
        );
        return socket.readyState === 1 ? socket.send(msg) : messageQueue.push(msg);
      }
      return next(action);
    };
  };
}
