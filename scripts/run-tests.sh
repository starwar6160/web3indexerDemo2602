#!/bin/bash
# Script to run compiled tests

echo "Building tests..."
npm run build

echo "Running reorg tests..."
node dist/tests/reorg.test.js

echo "Running stress tests..."
node dist/tests/stress.test.js
