# Frontend-Backend Communication Diagnosis and Fix Plan

## Problem Statement
The frontend is not communicating properly with the backend API server. API calls activated by frontend functions are not going through, resulting in failures or no responses.

## Current Status
- API server (localhost:3001) has been built and attempted to start
- Supabase local instance (localhost:54321) has been reset but storage container failed
- Frontend (localhost:5174) is configured to use Supabase for auth
- CORS has been configured to allow localhost any port
- Some API routes were simplified for testing (e.g., groups route returns 'test')

## Suspected Issues
1. **Authentication Failure**: Supabase auth errors (invalid refresh token) may be preventing authenticated API calls
2. **Server Not Running**: API server may not be running or accessible
3. **Incorrect URLs**: Frontend may be calling wrong endpoints
4. **Middleware Issues**: Auth middleware or other middleware blocking requests
5. **Query Parameter Handling**: Some routes fail with query parameters
6. **Service Initialization**: Supabase or cache services not properly initialized in API server

## Diagnosis Plan

### Phase 1: Infrastructure Check
1. **Verify Services Running**
   - Check if API server is running on port 3001
   - Check if Supabase is running on port 54321
   - Verify Docker containers are up (especially storage)

2. **Network Connectivity**
   - Test direct API calls using curl/PowerShell Invoke-WebRequest
   - Check if ports are accessible

### Phase 2: Authentication Investigation
1. **Clear Browser State**
   - Clear localStorage for localhost:5174
   - Test basic auth flow

2. **Auth Endpoint Testing**
   - Test Supabase auth endpoints directly
   - Verify anon key and URLs in .env

### Phase 3: API Route Analysis
1. **Add Comprehensive Logging**
   - Add request logging to all API routes
   - Log incoming requests, auth status, parameters
   - Log service initialization status

2. **Test Individual Endpoints**
   - Test health endpoint (/api/v1/health)
   - Test simplified routes (groups without auth)
   - Test routes with auth disabled

3. **Frontend Request Inspection**
   - Check browser Network tab for outgoing requests
   - Verify request URLs, headers, methods
   - Compare with expected API endpoints

### Phase 4: Middleware and Service Debugging
1. **Middleware Bypass**
   - Temporarily disable auth middleware on test routes
   - Test if requests go through without auth

2. **Service Injection Check**
   - Verify supabaseService and cacheService are initialized
   - Add logs in route initialization

3. **Error Handling**
   - Ensure asyncHandler catches all errors
   - Add try-catch blocks in routes

### Phase 5: Integration Testing
1. **End-to-End Flow**
   - Perform specific frontend actions (e.g., load dashboard, create flashcard)
   - Correlate with server logs
   - Identify where requests fail

2. **Query Parameter Testing**
   - Test routes with and without query parameters
   - Debug parameter parsing

## Implementation Steps

### Immediate Actions
1. Add request logging middleware to API server
2. Verify server startup and service initialization
3. Test basic endpoints without auth

### Logging Strategy
- Add Morgan or custom logging middleware for all requests
- Log route hits, user auth status, request body/query
- Log service method calls and results

### Testing Protocol
- User performs specific actions in frontend
- Checks browser console and network tab
- Provides screenshots/logs if needed
- Correlates with server logs

## Success Criteria
- All frontend API calls reach the server
- Server responds with appropriate status codes
- Authentication works without errors
- Data flows correctly between frontend and backend

## Contingency Plans
- If auth is blocking, implement token refresh handling
- If services not initializing, fix dependency injection
- If routes failing, simplify and rebuild incrementally
- If network issues, verify firewall/Docker configuration

## Next Steps
1. Add logging to API server
2. Restart server and verify logs appear
3. Test basic endpoints
4. Clear browser state and test auth
5. Perform frontend actions and analyze logs</content>
<parameter name="filePath">c:\Users\Ben Amadi\Downloads\lantern-study__ 111625\diagnosis_plan.md