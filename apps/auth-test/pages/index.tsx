/**
 * @file apps/auth-test/pages/index.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description The main page for the auth-test application.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { api, useWebSocket } from 'sharedFrontend';
import {
  getTableItem,
  getAllTableItems,
  sendWorkOrderMessage,
  getWebSocketConnection,
  getWebSocketConnectionNoToken
} from 'sharedFrontend';

/**
 * @component Home
 * @description The main page for the auth-test application.
 * @returns {React.FC} The Home component.
 */
export default function Home() {
  const router = useRouter();
  const { pid, hash } = router.query;
  const { status, lastMessage, connect, disconnect } = useWebSocket();

  const [student, setStudent] = useState<any>(null);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingAllStudents, setIsLoadingAllStudents] = useState(false);
  const [studentsProgress, setStudentsProgress] = useState<number>(0);
  const [websocketError, setWebsocketError] = useState<string | null>(null);
  const [websocketMessages, setWebsocketMessages] = useState<any[]>([]);
  const [sqsError, setSqsError] = useState<string | null>(null);
  const [sqsSuccess, setSqsSuccess] = useState<string | null>(null);

  /**
   * @function getStudentData
   * @description Fetches the student data from the API.
   */
  const getStudentData = async () => {
    if (!pid || !hash) return;
    setError(null);
    setIsLoading(true);
    try {
      const data = await getTableItem('students', pid as string, pid as string, hash as string);

      // Check if we got a redirect response
      if (data && data.redirected) {
        console.log('[Student] Redirecting to login');
        return;
      }

      setStudent(data);
    } catch (err: any) {
      setError(err.message || 'Unexpected error');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * @function getAllStudentsData
   * @description Fetches all student data from the API.
   */
  const getAllStudentsData = async () => {
    if (!pid || !hash) return;
    setError(null);
    setIsLoadingAllStudents(true);
    setStudentsProgress(0);
    try {
      const data = await getAllTableItems('students', pid as string, hash as string, (count, chunkNumber, totalChunks) => {
        setStudentsProgress(count);
        console.log(`[Students] Chunk ${chunkNumber}/${totalChunks}: Received ${count} students total`);
      });

      // Check if we got a redirect response
      if (data && 'redirected' in data) {
        console.log('[Students] Redirecting to login');
        return;
      }

      setAllStudents(data as any[]);
      console.log('Final students count:', (data as any[]).length);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch all students');
    } finally {
      setIsLoadingAllStudents(false);
      setStudentsProgress(0);
    }
  };

  /**
   * @function sendWorkOrderMessageData
   * @description Sends a work order message to the SQS queue.
   */
  const sendWorkOrderMessageData = async () => {
    if (!pid || !hash) return;
    setSqsError(null);
    setSqsSuccess(null);

    try {
      const response = await sendWorkOrderMessage('test-work-order-123', 'Count', 'start', pid as string, hash as string);

      // Check if we got a redirect response
      if (response && 'redirected' in response) {
        console.log('[SQS] Redirecting to login');
        return;
      }

      setSqsSuccess(`Successfully sent SQS message. Message ID: ${response.messageId}`);
    } catch (err: any) {
      setSqsError(err.message || 'Failed to send SQS message');
    }
  };

  /**
   * @function handleWebSocketConnect
   * @description Handles the WebSocket connection.
   * @param {'workorders' | 'students'} resource - The resource to connect to.
   */
  const handleWebSocketConnect = async (resource: 'workorders' | 'students' = 'workorders') => {
    if (!pid || !hash) return;
    setWebsocketError(null);
    console.log('[WebSocket] Starting connection process...');
    try {
      console.log('[WebSocket] Getting connection details for resource:', resource);
      const response = await getWebSocketConnection(resource, pid as string, hash as string);

      // Check if we got a redirect response
      if (response && 'redirected' in response) {
        console.log('[WebSocket] Redirecting to login');
        return;
      }

      console.log('[WebSocket] Received response:', response);
      console.log('[WebSocket] Connecting to URL:', response.websocketUrl);
      connect(response.websocketUrl);
    } catch (err: any) {
      // Log error details for debugging but don't show in browser console
      console.log('[WebSocket] Connection failed:', {
        message: err.message,
        status: err.status,
        details: err.details
      });

      // Set the error message to display in the UI
      setWebsocketError(err.message || 'Failed to connect to WebSocket');

      // Prevent the error from bubbling up to the browser
      return;
    }
  };

  /**
   * @function handleWebSocketDisconnect
   * @description Handles the WebSocket disconnection.
   */
  const handleWebSocketDisconnect = () => {
    disconnect();
  };

  /**
   * @function handleWebSocketConnectNoToken
   * @description Handles the WebSocket connection without a token.
   * @param {'workorders' | 'students'} resource - The resource to connect to.
   */
  const handleWebSocketConnectNoToken = async (resource: 'workorders' | 'students' = 'workorders') => {
    if (!pid || !hash) return;
    setWebsocketError(null);
    console.log('[WebSocket] Starting connection process (no token)...');
    try {
      console.log('[WebSocket] Getting connection details for resource (no token):', resource);
      const response = await getWebSocketConnectionNoToken(resource, pid as string, hash as string);

      // Check if we got a redirect response
      if (response && 'redirected' in response) {
        console.log('[WebSocket] Redirecting to login');
        return;
      }

      console.log('[WebSocket] Received response (no token):', response);
      console.log('[WebSocket] Connecting to URL (no token):', response.websocketUrl);
      connect(response.websocketUrl);
    } catch (err: any) {
      // Log error details for debugging but don't show in browser console
      console.log('[WebSocket] Connection failed (no token):', {
        message: err.message,
        status: err.status,
        details: err.details
      });

      // Set the error message to display in the UI
      setWebsocketError(err.message || 'Failed to connect to WebSocket (no token)');

      // Prevent the error from bubbling up to the browser
      return;
    }
  };

  // Add new messages to the list when they arrive
  useEffect(() => {
    if (lastMessage) {
      setWebsocketMessages(prev => [...prev, { timestamp: new Date().toISOString(), message: lastMessage }]);
    }
  }, [lastMessage]);

  // Listen for WebSocket errors
  useEffect(() => {
    const handleWebSocketError = (event: CustomEvent) => {
      console.log('[WebSocket] Error event received:', event.detail);
      setWebsocketError(event.detail.error);
    };

    window.addEventListener('websocket-error', handleWebSocketError as EventListener);

    return () => {
      window.removeEventListener('websocket-error', handleWebSocketError as EventListener);
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-inter">
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-2xl w-full">
        <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">Auth Test</h1>

        <div className="mb-6 p-4 bg-blue-50 text-blue-700 rounded-lg border border-blue-200">
          <p className="text-sm">
            <strong>PID:</strong> {pid || 'Not provided'}
          </p>
          <p className="text-sm">
            <strong>Hash:</strong> {hash ? `${(Array.isArray(hash) ? hash[0] : hash).substring(0, 20)}...` : 'Not provided'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-lg border border-red-200">
            <p className="font-semibold">Error:</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {/* Table Subsystem Section */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">Table Subsystem</h3>

          <div className="text-center mb-4">
            <button
              onClick={getStudentData}
              disabled={isLoading || !pid || !hash}
              className={`
                px-6 py-3 rounded-lg text-white font-semibold text-lg
                transition-all duration-300 ease-in-out
                ${isLoading || !pid || !hash
                  ? 'bg-indigo-300 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md hover:shadow-lg'
                }
              `}
            >
              {isLoading ? 'Loading...' : 'Get Student Data'}
            </button>
          </div>

          <div className="text-center mb-4">
            <button
              onClick={getAllStudentsData}
              disabled={isLoadingAllStudents || !pid || !hash}
              className={`
                px-6 py-3 rounded-lg text-white font-semibold text-lg
                transition-all duration-300 ease-in-out
                ${isLoadingAllStudents || !pid || !hash
                  ? 'bg-green-300 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 active:bg-green-800 shadow-md hover:shadow-lg'
                }
              `}
            >
              {isLoadingAllStudents ? `Loading... (${studentsProgress} students)` : 'List All Student Data'}
            </button>
          </div>

          {allStudents.length > 0 && (
            <div className="mt-4">
              <h4 className="text-md font-semibold text-gray-800 mb-2">
                All Students ({allStudents.length} total)
              </h4>
              <div className="bg-gray-50 p-4 rounded-lg border max-h-40 overflow-y-auto">
                <div className="space-y-2">
                  {allStudents.map((student, index) => (
                    <div key={index} className="text-sm text-gray-700 border-b border-gray-200 pb-2">
                      <div><strong>Name:</strong> {student.first} {student.last}</div>
                      <div><strong>Email:</strong> {student.email || 'N/A'}</div>
                      <div><strong>ID:</strong> {student.id}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* WebSocket Section */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">WebSocket Subsystem</h3>

          {websocketError && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg border border-red-200">
              <p className="text-sm">{websocketError}</p>
            </div>
          )}

          <div className="text-center mb-4">
            {status === 'closed' ? (
              <div className="space-y-2">
                <button
                  onClick={() => handleWebSocketConnect('workorders')}
                  disabled={!pid || !hash || ['open', 'connecting'].includes(status)}
                  className={`
                    px-6 py-3 rounded-lg text-white font-semibold
                    transition-all duration-300 ease-in-out
                    ${!pid || !hash || ['open', 'connecting'].includes(status)
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700 active:bg-green-800 shadow-md hover:shadow-lg'
                    }
                  `}
                >
                  WebSocket Connect (Workorders)
                </button>
                <button
                  onClick={() => handleWebSocketConnect('students')}
                  disabled={!pid || !hash || ['open', 'connecting'].includes(status)}
                  className={`
                    px-6 py-3 rounded-lg text-white font-semibold
                    transition-all duration-300 ease-in-out
                    ${!pid || !hash || ['open', 'connecting'].includes(status)
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-md hover:shadow-lg'
                    }
                  `}
                >
                  WebSocket Connect (Students)
                </button>
                <button
                  onClick={() => handleWebSocketConnectNoToken('workorders')}
                  disabled={!pid || !hash || ['open', 'connecting'].includes(status)}
                  className={`
                    px-6 py-3 rounded-lg text-white font-semibold
                    transition-all duration-300 ease-in-out
                    ${!pid || !hash || ['open', 'connecting'].includes(status)
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-orange-600 hover:bg-orange-700 active:bg-orange-800 shadow-md hover:shadow-lg'
                    }
                  `}
                >
                  WebSocket Connect No Token (Workorders)
                </button>
                <button
                  onClick={() => handleWebSocketConnectNoToken('students')}
                  disabled={!pid || !hash || ['open', 'connecting'].includes(status)}
                  className={`
                    px-6 py-3 rounded-lg text-white font-semibold
                    transition-all duration-300 ease-in-out
                    ${!pid || !hash || ['open', 'connecting'].includes(status)
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-orange-600 hover:bg-orange-700 active:bg-orange-800 shadow-md hover:shadow-lg'
                    }
                  `}
                >
                  WebSocket Connect No Token (Students)
                </button>
              </div>
            ) : (
              <button
                onClick={handleWebSocketDisconnect}
                disabled={!['open', 'connecting'].includes(status)}
                className={`px-6 py-3 rounded-lg text-white font-semibold transition-all duration-300 ease-in-out
                  ${!['open', 'connecting'].includes(status)
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700 active:bg-red-800 shadow-md hover:shadow-lg'
                  }
                `}
              >
                WebSocket Disconnect
              </button>
            )}
          </div>

          <div className="text-center mb-4">
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${status === 'connecting' ? 'bg-yellow-100 text-yellow-800' :
              status === 'open' ? 'bg-green-100 text-green-800' :
                'bg-gray-100 text-gray-800'
              }`}>
              Status: {status}
            </span>
          </div>

          {websocketMessages.length > 0 && (
            <div className="bg-gray-50 p-4 rounded-lg border">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">WebSocket Messages:</h4>
              <div className="max-h-40 overflow-y-auto">
                {websocketMessages.map((msg, index) => (
                  <div key={index} className="mb-2 p-2 bg-white rounded border text-xs">
                    <div className="text-gray-500 mb-1">{msg.timestamp}</div>
                    <pre className="text-gray-700 whitespace-pre-wrap">
                      {JSON.stringify(msg.message, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SQS Subsystem Section */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">SQS Subsystem</h3>

          {sqsError && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg border border-red-200">
              <p className="text-sm">{sqsError}</p>
            </div>
          )}

          {sqsSuccess && (
            <div className="mb-4 p-3 bg-green-100 text-green-700 rounded-lg border border-green-200">
              <p className="text-sm">{sqsSuccess}</p>
            </div>
          )}

          <div className="text-center mb-4">
            <button
              onClick={sendWorkOrderMessageData}
              disabled={!pid || !hash}
              className={`
                px-6 py-3 rounded-lg text-white font-semibold
                transition-all duration-300 ease-in-out
                ${!pid || !hash
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700 active:bg-purple-800 shadow-md hover:shadow-lg'
                }
              `}
            >
              Send Message
            </button>
          </div>
        </div>

        {student && (
          <div className="mt-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Student Information for {student.first} {student.last}
            </h2>
            <div className="bg-gray-50 p-4 rounded-lg border">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto">
                {JSON.stringify(student, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {(!pid || !hash) && (
          <div className="mt-6 p-4 bg-yellow-100 text-yellow-700 rounded-lg border border-yellow-200">
            <p className="font-semibold">Missing Parameters:</p>
            <p className="text-sm mt-1">
              Please ensure both PID and Hash are provided in the URL parameters to test the API.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}