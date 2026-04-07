/**
 * @description
 * This test class validates the behavior of the EinsteinChatController Apex class, 
 * which interacts with an external AI chat service. It uses multiple mock implementations 
 * to simulate HTTP responses for:
 *  - Authentication via EinsteinAuthService
 *  - Chat session initiation
 *  - Message exchange
 * 
 * Custom Metadata (CMDT) records can't be inserted during tests, so the code assumes
 * such records already exist or the production methods handle their absence gracefully.
 * Author - Reetabrata
 */

@isTest
private class EinsteinChatControllerTest {
 /**
     * Mock for simulating a successful chat session creation response.
     */
    private class MockStartSessionCallout implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(201); // HTTP 201 Created
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"sessionId": "abc123", "messages": [{"message": "Welcome to chat!"}]}');
            return res;
        }
    }

    /**
     * Mock for simulating a successful send message response from the AI.
     */
    private class MockSendMessageCallout implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200); // HTTP 200 OK
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"messages": [{"message": "Sure, I can help you with that!"}]}');
            return res;
        }
    }

    /**
     * Mock for simulating a successful authentication response from the token service.
     */
    private class MockAuthCallout implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200); // HTTP 200 OK
            res.setBody('{"access_token":"mock_token","instance_url":"https://mock.salesforce.com","token_type":"Bearer","expires_in":3600}');
            return res;
        }
    }

    /**
     * Test setup method for metadata, kept for structure though CMDT can't be inserted here.
     */
    @testSetup
    static void setupMetadata() {
        // No CMDT insertions possible in test context
    }

    /**
     * Unit test for the startChatSession method.
     * It mocks both the auth and session start callouts, then asserts the expected session ID and welcome message.
     */
    @isTest
    static void testStartChatSession() {
        // Chain mocks: Auth first, then Start Chat
        Test.setMock(HttpCalloutMock.class, new MultiMock(new List<HttpCalloutMock>{
            new MockAuthCallout(),
            new MockStartSessionCallout()
        }));

        Test.startTest();
        Map<String, String> result = EinsteinChatController.startChatSession(null);
        Test.stopTest();

        // Validate session ID and welcome message
        System.assertEquals('abc123', result.get('sessionId'));
        System.assertEquals('Welcome to chat!', result.get('message'));
    }

    /**
     * Unit test for sendChatMessage method.
     * Mocks both auth and message send responses and verifies the returned message.
     */
    @isTest
    static void testSendChatMessage() {
        // Chain mocks: Auth first, then Send Message
        Test.setMock(HttpCalloutMock.class, new MultiMock(new List<HttpCalloutMock>{
            new MockAuthCallout(),
            new MockSendMessageCallout()
        }));

        Test.startTest();
        String response = EinsteinChatController.sendChatMessage('abc123', 'Hello');
        Test.stopTest();

        // Validate AI response message
        System.assertEquals('Sure, I can help you with that!', response);
    }

    /**
     * Unit test for getLanguageMapJson.
     * Simply checks that a non-null JSON string is returned (content depends on CMDT).
     */
    @isTest
    static void testGetLanguageMapJson() {
        Test.startTest();
        String langJson = EinsteinChatController.getLanguageMapJson();
        Test.stopTest();

        System.assertNotEquals(null, langJson, 'Language map JSON should not be null');
    }

    /**
     * Unit test for getMetadataInfo.
     * Ensures a non-null Custom Metadata object is returned if it exists in org.
     */
    @isTest
    static void testGetMetadataInfo() {
        Test.startTest();
        Custom_Agent_Configuration__mdt config = EinsteinChatController.getMetadataInfo();
        Test.stopTest();

        System.assertNotEquals(null, config, 'Custom metadata record should not be null');
    }

    /**
     * Helper class for sequencing multiple callout mocks.
     * Each call to `respond()` progresses to the next mock in the list.
     */
    private class MultiMock implements HttpCalloutMock {
        private List<HttpCalloutMock> mocks;
        private Integer index = 0;

        MultiMock(List<HttpCalloutMock> mocks) {
            this.mocks = mocks;
        }

        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = mocks[index].respond(req);
            index = Math.min(index + 1, mocks.size() - 1); // Prevent out-of-bounds
            return res;
        }
    }
}