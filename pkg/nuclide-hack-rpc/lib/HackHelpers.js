'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {HackRange} from './rpc-types';

import invariant from 'assert';
import {asyncExecute} from '../../commons-node/process';
import {PromiseQueue} from '../../commons-node/promise-executors';
import {getHackExecOptions} from './hack-config';
import {Point, Range} from 'simple-text-buffer';

const HH_SERVER_INIT_MESSAGE = 'hh_server still initializing';
const HH_SERVER_BUSY_MESSAGE = 'hh_server is busy';
import {logger} from './hack-config';

let hhPromiseQueue: ?PromiseQueue = null;

 /**
  * Executes hh_client with proper arguments returning the result string or json object.
  */
export async function callHHClient(
  args: Array<any>,
  errorStream: boolean,
  processInput: ?string,
  filePath: string): Promise<?(string | Object)> {

  if (!hhPromiseQueue) {
    hhPromiseQueue = new PromiseQueue();
  }

  const hackExecOptions = await getHackExecOptions(filePath);
  if (!hackExecOptions) {
    return null;
  }
  const {hackRoot, hackCommand} = hackExecOptions;

  invariant(hhPromiseQueue);
  return hhPromiseQueue.submit(async (resolve, reject) => {
    // Append args on the end of our commands.
    const defaults = ['--json', '--retries', '0', '--retry-if-init', 'false', '--from', 'nuclide'];

    const allArgs = defaults.concat(args);
    allArgs.push(hackRoot);

    let execResult = null;
    try {
      logger.logTrace(`Calling Hack: ${hackCommand} with ${allArgs.toString()}`);
      execResult = await asyncExecute(hackCommand, allArgs, {stdin: processInput});
    } catch (err) {
      reject(err);
      return;
    }
    const {stdout, stderr} = execResult;
    if (stderr.indexOf(HH_SERVER_INIT_MESSAGE) !== -1) {
      reject(new Error(`${HH_SERVER_INIT_MESSAGE}: try: \`arc build\` or try again later!`));
      return;
    } else if (stderr.startsWith(HH_SERVER_BUSY_MESSAGE)) {
      reject(new Error(`${HH_SERVER_BUSY_MESSAGE}: try: \`arc build\` or try again later!`));
      return;
    }

    const output = errorStream ? stderr : stdout;
    logger.logTrace(`Hack output for ${allArgs.toString()}: ${output}`);
    try {
      const result = JSON.parse(output);
      invariant(result.hackRoot === undefined);
      // result may be an array, so don't return a new object.
      result.hackRoot = hackRoot;
      resolve(result);
    } catch (err) {
      const errorMessage = `hh_client error, args: [${args.join(',')}]
stdout: ${stdout}, stderr: ${stderr}`;
      logger.logError(errorMessage);
      reject(new Error(errorMessage));
    }
  });
}

export function hackRangeToAtomRange(position: HackRange): atom$Range {
  return new Range(
    atomPointOfHackRangeStart(position),
    new Point(
      position.line - 1,
      position.char_end),
  );
}

export function atomPointOfHackRangeStart(position: HackRange): atom$Point {
  return new Point(
    position.line - 1,
    position.char_start - 1);
}

export const HACK_WORD_REGEX = /[a-zA-Z0-9_$]+/g;
