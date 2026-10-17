#!/usr/bin/env python3
"""Controlled local PTYs for Rust Zellij integration tests; never uses a user's SSH host.

The Rust fixture provides private XDG/socket/config directories and an isolated PATH.
Only clients created by this process are stopped. Server teardown is performed by
the Rust owner using the same private namespace and exact synthetic session names.
"""
import json
import fcntl
import os
import pty
import select
import signal
import sys
import struct
import termios
import threading
import time

clients = {}

def start(command):
    pid, master = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
        os.execv('/bin/sh', ['sh', '-c', command])
    record = {'pid': pid, 'fd': master, 'output': bytearray(), 'status': None}
    clients[pid] = record
    def read():
        while record['fd'] is not None:
            try:
                if select.select([master], [], [], .1)[0]:
                    chunk = os.read(master, 65536)
                    if not chunk: break
                    record['output'].extend(chunk)
                    if len(record['output']) > 262144: del record['output'][:-262144]
            except (OSError, ValueError): break
    threading.Thread(target=read, daemon=True).start()
    return pid

def status(record):
    if record['status'] is None:
        try:
            pid, value = os.waitpid(record['pid'], os.WNOHANG)
            if pid: record['status'] = os.waitstatus_to_exitcode(value)
        except ChildProcessError: record['status'] = -1
    return record['status']

def stop(record):
    if record['fd'] is not None:
        os.close(record['fd']); record['fd'] = None
    deadline = time.monotonic() + 3
    while status(record) is None and time.monotonic() < deadline: time.sleep(.02)
    if status(record) is None:
        try: os.killpg(record['pid'], signal.SIGTERM)
        except ProcessLookupError: pass
        deadline = time.monotonic() + 2
        while status(record) is None and time.monotonic() < deadline: time.sleep(.02)
    if status(record) is None:
        try: os.killpg(record['pid'], signal.SIGKILL)
        except ProcessLookupError: pass

try:
    for line in sys.stdin:
        request = json.loads(line)
        if request['op'] == 'start': response = {'pid': start(request['command'])}
        elif request['op'] == 'output':
            record = clients[request['pid']]
            response = {'status': status(record), 'output': record['output'].decode('utf-8', errors='replace')}
        elif request['op'] == 'stop':
            stop(clients[request['pid']]); response = {'stopped': True}
        elif request['op'] == 'quit':
            for record in clients.values(): stop(record)
            print(json.dumps({'stopped': True}), flush=True)
            break
        else: raise ValueError('unknown operation')
        print(json.dumps(response), flush=True)
finally:
    for record in clients.values(): stop(record)
