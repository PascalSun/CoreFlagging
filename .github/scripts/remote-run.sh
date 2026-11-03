#!/usr/bin/env bash
# remote-run.sh — run a long command on the app server DETACHED, and follow it with short ssh calls that survive a
# dropped tunnel. Used by the deploy workflows for the redeploy itself (the docker build + recreate + READY gate):
# one long-lived ssh through the Cloudflare tunnel and the jump box used to stream the whole build, and when either
# hop dropped mid-build (often with several repos deploying at once) the job failed with 255 although the server
# carried on. Now the command runs under nohup/setsid on the server, writing its output and exit code under
# /tmp/deploy-<tag>/, and this script polls that with short, retried ssh calls (reopening the tunnel if it died),
# printing new output as it comes and exiting with the command's own exit code.
#
#   remote-run.sh <tag> <command run with bash on the app server>
#
# The tag must be unique per attempt (run id + attempt): starting is idempotent on it, so a retried start never
# runs the command twice. Env, from the workflow step (secrets; nothing here is infra-specific):
#   USER                       the jump box account
#   PASS + HOST + PORT         password login to the jump box (the tunnel's local end), or
#   KEYFILE                    a private key for the jump box at 127.0.0.1:${TUNNEL_PORT}
#   SERVER, SERVER_USER        the app server, reached from the jump box
#   TUNNEL_HOSTNAME            the jump box's Cloudflare hostname, to reopen the tunnel if it died
#   TUNNEL_PORT (12222)        the tunnel's local port; DEADLINE_S (5400) overall limit; POLL_S (10)
set -uo pipefail
TAG="$1"; shift
CMD="$*"
TUNNEL_PORT="${TUNNEL_PORT:-12222}"
DEADLINE_S="${DEADLINE_S:-5400}"
POLL_S="${POLL_S:-10}"
D="/tmp/deploy-${TAG}"
KA=(-o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o StrictHostKeyChecking=no)

jump() {   # run "$1" on the jump box (one short ssh)
  if [ -n "${KEYFILE:-}" ]; then
    ssh -i "$KEYFILE" "${KA[@]}" -p "$TUNNEL_PORT" "${USER}@127.0.0.1" "$1"
  else
    SSHPASS="$PASS" sshpass -e ssh "${KA[@]}" -o PreferredAuthentications=password -p "${PORT:-$TUNNEL_PORT}" \
      "${USER}@${HOST:-127.0.0.1}" "$1"
  fi
}

on_server() {   # run the bash script "$1" on the app server, through the jump box; base64 so no quoting survives hops
  local b64
  b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  jump "ssh -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o StrictHostKeyChecking=no \
${SERVER_USER}@${SERVER} 'echo $b64 | base64 -d | bash'"
}

reopen_tunnel() {   # the tunnel's local end answers no more: start cloudflared again
  nc -z 127.0.0.1 "$TUNNEL_PORT" 2>/dev/null && return 0
  [ -n "${TUNNEL_HOSTNAME:-}" ] && [ -x /tmp/cloudflared ] || return 0
  echo "remote-run: tunnel down, reopening" >&2
  if [ -f /tmp/cloudflared.pid ]; then kill "$(cat /tmp/cloudflared.pid)" 2>/dev/null || true; fi
  /tmp/cloudflared access tcp --hostname "$TUNNEL_HOSTNAME" --url "127.0.0.1:${TUNNEL_PORT}" >> /tmp/cloudflared.log 2>&1 &
  echo $! > /tmp/cloudflared.pid
  for _ in $(seq 30); do nc -z 127.0.0.1 "$TUNNEL_PORT" 2>/dev/null && return 0; sleep 1; done
}

OUT=$(mktemp)
retry() {   # on_server "$1" into $OUT, retried with backoff over a dropped connection (ssh exits 255)
  local i rc=1
  for i in 1 2 3 4 5 6 7 8; do
    on_server "$1" > "$OUT"
    rc=$?
    [ "$rc" -eq 0 ] && return 0
    echo "remote-run: ssh failed (exit $rc), attempt $i of 8; retrying" >&2
    reopen_tunnel
    sleep $(( i * 5 ))
  done
  return "$rc"
}

# Start (idempotent: mkdir is the claim, so a start retried after a lost reply does not run the command twice).
CMD_B64=$(printf '%s' "$CMD" | base64 | tr -d '\n')
START="find /tmp -maxdepth 1 -name 'deploy-*' -mtime +3 -exec rm -rf {} + 2>/dev/null
if mkdir '$D' 2>/dev/null; then
  echo '$CMD_B64' | base64 -d > '$D/cmd.sh'
  nohup setsid bash -c 'bash $D/cmd.sh; echo \$? > $D/rc.tmp; mv $D/rc.tmp $D/rc' > '$D/log' 2>&1 < /dev/null &
  echo started
else
  echo 'already started'
fi"
retry "$START" || { echo "remote-run: could not start the command on the server"; exit 1; }
cat "$OUT"

# Follow: each poll prints a header line 'SIZE <bytes> RC <code|->' then the log bytes since the last offset.
off=0
t0=$(date +%s)
while :; do
  # rc before size: rc is written after the last log byte, so once it is there the size read next is final
  POLL="r=\$(cat '$D/rc' 2>/dev/null || echo -); s=\$(stat -c%s '$D/log' 2>/dev/null || echo 0)
echo \"SIZE \$s RC \$r\"; head -c \"\$s\" '$D/log' 2>/dev/null | tail -c +$((off + 1))"
  if ! retry "$POLL"; then
    echo "remote-run: lost the server for good; the command may still be running there (log: $D/log)"; exit 1
  fi
  header=$(head -n 1 "$OUT")
  size=$(echo "$header" | awk '{print $2}')
  rc=$(echo "$header" | awk '{print $4}')
  tail -n +2 "$OUT"                                   # the new output, bytes as written
  [[ "$size" =~ ^[0-9]+$ ]] && off=$size
  if [ "$rc" != "-" ] && [ -n "$rc" ]; then
    echo; echo "remote-run: finished with exit code $rc"
    exit "$rc"
  fi
  if [ $(( $(date +%s) - t0 )) -gt "$DEADLINE_S" ]; then
    echo; echo "remote-run: still running after ${DEADLINE_S}s; giving up following it (log: $D/log)"; exit 1
  fi
  sleep "$POLL_S"
done
