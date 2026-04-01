#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Testing Cash API Endpoints${NC}\n"

# Test 1: GET /api/cash (should return null or current balance)
echo -e "${YELLOW}Test 1: GET /api/cash${NC}"
curl -s http://localhost:3000/api/cash | jq .
echo -e "\n"

# Test 2: POST /api/cash (create deposit)
echo -e "${YELLOW}Test 2: POST /api/cash (DEPOSITO)${NC}"
curl -s -X POST http://localhost:3000/api/cash \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-03-31",
    "type": "DEPOSITO",
    "amount": 1000,
    "description": "Initial deposit test"
  }' | jq .
echo -e "\n"

# Test 3: GET /api/cash/movements
echo -e "${YELLOW}Test 3: GET /api/cash/movements${NC}"
curl -s http://localhost:3000/api/cash/movements | jq .
echo -e "\n"

# Test 4: POST another movement (RETIRO)
echo -e "${YELLOW}Test 4: POST /api/cash (RETIRO)${NC}"
curl -s -X POST http://localhost:3000/api/cash \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-03-31",
    "type": "RETIRO",
    "amount": 200,
    "description": "Withdrawal test"
  }' | jq .
echo -e "\n"

# Test 5: GET balance again (should be 800)
echo -e "${YELLOW}Test 5: GET /api/cash (after movements)${NC}"
curl -s http://localhost:3000/api/cash | jq .
echo -e "\n"

echo -e "${GREEN}All tests completed!${NC}"
