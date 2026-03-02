/**
 * chat-feeder-script.ts — Shell script that wraps subzeroclaw in interactive
 * REPL mode, feeding user messages via an anonymous pipe.
 *
 * CheerpX doesn't support FIFOs (mkfifo) or inotify (tail -f), but anonymous
 * pipes work fine. A while-loop checks for signal files and echoes messages
 * into subzeroclaw's stdin through the pipe:
 *
 *   while true; do ... echo "$msg" ... done | subzeroclaw > output.log
 *
 * The browser writes /tmp/chat_msg + touches /tmp/chat_send to deliver messages.
 */

/* eslint-disable no-useless-escape */

export const CHAT_FEEDER_SCRIPT = [
  '#!/bin/bash',
  '# chat-feeder.sh — anonymous-pipe wrapper for subzeroclaw interactive mode',
  '',
  '# Clean previous state',
  'rm -f /tmp/chat_ready /tmp/chat_stop /tmp/chat_send /tmp/chat_msg /tmp/chat_output.log 2>/dev/null',
  '',
  '# Signal browser that chat agent is ready',
  'touch /tmp/chat_ready',
  '',
  '# The while loop\'s stdout is piped into subzeroclaw\'s stdin.',
  '# Each echo inside the loop delivers a message through the anonymous pipe.',
  '(',
  '  while true; do',
  '    if [ -f /tmp/chat_stop ]; then',
  '      echo "/quit"',
  '      exit 0',
  '    fi',
  '    if [ -f /tmp/chat_send ]; then',
  '      if [ -f /tmp/chat_msg ]; then',
  '        cat /tmp/chat_msg',
  '        echo ""',
  '      fi',
  '      rm -f /tmp/chat_send /tmp/chat_msg',
  '    fi',
  '    sleep 0.3',
  '  done',
  ') | subzeroclaw > /tmp/chat_output.log 2>&1',
  '',
  '# Cleanup on exit',
  'rm -f /tmp/chat_ready /tmp/chat_stop /tmp/chat_send /tmp/chat_msg 2>/dev/null',
].join('\n');
