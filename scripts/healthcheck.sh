#!/bin/sh
# Docker healthcheck for swaproxy-engine
curl -sf -x "http://demo:swapproxy2024@127.0.0.1:3128" \
  --max-time 5 http://httpbin.org/ip > /dev/null 2>&1
