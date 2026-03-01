#!/bin/bash
# curl-bridge.sh — curl replacement that bridges HTTP requests through browser fetch()
#
# Parses the curl flags that subzeroclaw produces:
#   curl -s -m 120 -K '/tmp/.szc_hdr_XXX' -H 'Content-Type: application/json' -d @'/tmp/.szc_body_XXX' 'https://...'
#
# Serializes the request to /tmp/bridge/requests/<id>.json,
# touches .ready, and polls for /tmp/bridge/responses/<id>.json.ready

BRIDGE_DIR="/tmp/bridge"
REQUESTS_DIR="$BRIDGE_DIR/requests"
RESPONSES_DIR="$BRIDGE_DIR/responses"
STOP_FILE="$BRIDGE_DIR/stop"

# Check stop flag
if [ -f "$STOP_FILE" ]; then
  echo '{"error":{"message":"agent stopped"}}' >&2
  exit 1
fi

# Parse curl arguments
METHOD="GET"
URL=""
BODY=""
SILENT=0
TIMEOUT=120
declare -a HEADERS_KEYS=()
declare -a HEADERS_VALS=()

while [ $# -gt 0 ]; do
  case "$1" in
    -s)
      SILENT=1
      shift
      ;;
    -m)
      TIMEOUT="$2"
      shift 2
      ;;
    -X)
      METHOD="$2"
      shift 2
      ;;
    -H)
      # Parse "Key: Value" header
      HDR="$2"
      KEY="${HDR%%:*}"
      VAL="${HDR#*: }"
      HEADERS_KEYS+=("$KEY")
      HEADERS_VALS+=("$VAL")
      shift 2
      ;;
    -K)
      # Header file (subzeroclaw format: -H "Authorization: Bearer ...")
      HDRFILE="$2"
      if [ -f "$HDRFILE" ]; then
        while IFS= read -r line; do
          # Extract -H "Key: Value" patterns
          if [[ "$line" =~ -H\ \"([^\"]+)\" ]]; then
            HDR="${BASH_REMATCH[1]}"
            KEY="${HDR%%:*}"
            VAL="${HDR#*: }"
            HEADERS_KEYS+=("$KEY")
            HEADERS_VALS+=("$VAL")
          fi
        done < "$HDRFILE"
      fi
      shift 2
      ;;
    -d)
      # Inline data or @file reference
      DATA="$2"
      if [[ "$DATA" == @* ]]; then
        BODYFILE="${DATA:1}"
        # Remove surrounding quotes if present
        BODYFILE="${BODYFILE%\'}"
        BODYFILE="${BODYFILE#\'}"
        BODYFILE="${BODYFILE%\"}"
        BODYFILE="${BODYFILE#\"}"
        if [ -f "$BODYFILE" ]; then
          BODY=$(cat "$BODYFILE")
        fi
      else
        BODY="$DATA"
      fi
      # If we have a body, default to POST
      if [ "$METHOD" = "GET" ]; then
        METHOD="POST"
      fi
      shift 2
      ;;
    -*)
      # Skip unknown flags (with optional value)
      if [ $# -gt 1 ] && [[ ! "$2" == -* ]] && [[ ! "$2" == http* ]]; then
        shift 2
      else
        shift
      fi
      ;;
    *)
      # Positional arg = URL (strip surrounding quotes)
      URL="$1"
      URL="${URL%\'}"
      URL="${URL#\'}"
      URL="${URL%\"}"
      URL="${URL#\"}"
      shift
      ;;
  esac
done

if [ -z "$URL" ]; then
  echo "curl-bridge: no URL specified" >&2
  exit 1
fi

# Generate unique request ID
REQ_ID="req_$$_$(date +%s%N 2>/dev/null || echo $RANDOM)"

# Build headers JSON object
HEADERS_JSON="{"
for i in "${!HEADERS_KEYS[@]}"; do
  if [ "$i" -gt 0 ]; then HEADERS_JSON+=","; fi
  # Escape JSON strings
  K=$(printf '%s' "${HEADERS_KEYS[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')
  V=$(printf '%s' "${HEADERS_VALS[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')
  HEADERS_JSON+="\"$K\":\"$V\""
done
HEADERS_JSON+="}"

# Write body to a temp file to avoid JSON escaping issues in shell
BODY_FILE="$REQUESTS_DIR/${REQ_ID}.body"
printf '%s' "$BODY" > "$BODY_FILE"

# Write request JSON
cat > "$REQUESTS_DIR/${REQ_ID}.json" << REQEOF
{"id":"$REQ_ID","type":"http","method":"$METHOD","url":"$URL","headers":$HEADERS_JSON,"bodyFile":"$BODY_FILE","timeout":$TIMEOUT}
REQEOF

# Signal request is ready
touch "$REQUESTS_DIR/${REQ_ID}.ready"

# Poll for response (timeout after TIMEOUT seconds)
ELAPSED=0
while [ $ELAPSED -lt "$TIMEOUT" ]; do
  if [ -f "$STOP_FILE" ]; then
    echo '{"error":{"message":"agent stopped"}}' >&2
    rm -f "$REQUESTS_DIR/${REQ_ID}.json" "$REQUESTS_DIR/${REQ_ID}.ready" "$BODY_FILE" 2>/dev/null
    exit 1
  fi

  if [ -f "$RESPONSES_DIR/${REQ_ID}.ready" ]; then
    # Read and output response body
    if [ -f "$RESPONSES_DIR/${REQ_ID}.json" ]; then
      cat "$RESPONSES_DIR/${REQ_ID}.json"
    fi
    # Cleanup
    rm -f "$RESPONSES_DIR/${REQ_ID}.json" "$RESPONSES_DIR/${REQ_ID}.ready" \
          "$REQUESTS_DIR/${REQ_ID}.json" "$REQUESTS_DIR/${REQ_ID}.ready" \
          "$BODY_FILE" 2>/dev/null
    exit 0
  fi

  sleep 0.1
  ELAPSED=$((ELAPSED + 1))
  # Each iteration is ~0.1s, so multiply check by 10
  if [ $((ELAPSED % 10)) -eq 0 ]; then
    SECS=$((ELAPSED / 10))
    if [ $SECS -ge "$TIMEOUT" ]; then
      break
    fi
  fi
done

# Timeout
echo '{"error":{"message":"curl-bridge: request timed out"}}' >&2
rm -f "$REQUESTS_DIR/${REQ_ID}.json" "$REQUESTS_DIR/${REQ_ID}.ready" "$BODY_FILE" 2>/dev/null
exit 28
