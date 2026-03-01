#!/bin/bash
# cast-bridge.sh — cast replacement with smart routing
#
# Pure-compute subcommands run the native cast binary directly (no network needed).
# Network-dependent subcommands go through the browser bridge (same protocol as curl-bridge).

BRIDGE_DIR="/tmp/bridge"
REQUESTS_DIR="$BRIDGE_DIR/requests"
RESPONSES_DIR="$BRIDGE_DIR/responses"
STOP_FILE="$BRIDGE_DIR/stop"
CAST_NATIVE="/usr/local/bin/cast-native"

# Check stop flag
if [ -f "$STOP_FILE" ]; then
  echo "Error: agent stopped" >&2
  exit 1
fi

# Pure-compute subcommands — run native cast directly (no network needed)
if [ -x "$CAST_NATIVE" ]; then
  case "$1" in
    sig|keccak|keccak256|abi-encode|abi-decode|--to-wei|--from-wei|--to-hex|--to-dec|--to-base|max-uint|max-int)
      exec "$CAST_NATIVE" "$@"
      ;;
  esac
fi

# Network-dependent subcommands — bridge through browser
# Serialize the full cast command to a bridge request
REQ_ID="cast_$$_$(date +%s%N 2>/dev/null || echo $RANDOM)"

# Build JSON args array
ARGS_JSON="["
FIRST=1
for arg in "$@"; do
  if [ "$FIRST" -eq 0 ]; then ARGS_JSON+=","; fi
  FIRST=0
  # Escape JSON string
  ESCAPED=$(printf '%s' "$arg" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\n/\\n/g')
  ARGS_JSON+="\"$ESCAPED\""
done
ARGS_JSON+="]"

# Write request
cat > "$REQUESTS_DIR/${REQ_ID}.json" << REQEOF
{"id":"$REQ_ID","type":"cast","args":$ARGS_JSON}
REQEOF

# Signal ready
touch "$REQUESTS_DIR/${REQ_ID}.ready"

# Poll for response (120s timeout)
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $((TIMEOUT * 10)) ]; do
  if [ -f "$STOP_FILE" ]; then
    echo "Error: agent stopped" >&2
    rm -f "$REQUESTS_DIR/${REQ_ID}.json" "$REQUESTS_DIR/${REQ_ID}.ready" 2>/dev/null
    exit 1
  fi

  if [ -f "$RESPONSES_DIR/${REQ_ID}.ready" ]; then
    if [ -f "$RESPONSES_DIR/${REQ_ID}.json" ]; then
      cat "$RESPONSES_DIR/${REQ_ID}.json"
    fi
    # Cleanup
    rm -f "$RESPONSES_DIR/${REQ_ID}.json" "$RESPONSES_DIR/${REQ_ID}.ready" \
          "$REQUESTS_DIR/${REQ_ID}.json" "$REQUESTS_DIR/${REQ_ID}.ready" 2>/dev/null
    exit 0
  fi

  sleep 0.1
  ELAPSED=$((ELAPSED + 1))
done

echo "Error: cast bridge request timed out" >&2
rm -f "$REQUESTS_DIR/${REQ_ID}.json" "$REQUESTS_DIR/${REQ_ID}.ready" 2>/dev/null
exit 1
