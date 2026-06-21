import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://127.0.0.1:3001';

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health status 200': (r) => r.status === 200 });

  const ready = http.get(`${BASE_URL}/ready`);
  check(ready, { 'ready status 200': (r) => r.status === 200 });

  sleep(1);
}
