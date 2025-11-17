"use client";
import React, { useState, useEffect } from 'react';
import { Container, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import { getAllTableItems, authGetConfigValue } from 'sharedFrontend';

// Define interface for sub events
interface SubEvent {
    [key: string]: unknown;
}

export default function TestValidationPage() {
    const [events, setEvents] = useState<Array<{ aid: string; name: string; config?: { emailManager?: boolean }; subEvents?: Record<string, SubEvent> }>>([]);
    const [stages, setStages] = useState<Array<{ stage: string; description: string; order?: number; parentStages?: string[] }>>([]);
    const [eventCode, setEventCode] = useState('');
    const [subEvent, setSubEvent] = useState('');
    const [selectedStage, setSelectedStage] = useState('');
    const [subEvents, setSubEvents] = useState<string[]>([]);
    const [debugLog, setDebugLog] = useState<string[]>([]);
    const [userEventAccess, setUserEventAccess] = useState<string[]>([]);

    const addDebugLog = (message: string) => {
        setDebugLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    };

    useEffect(() => {
        const loadData = async () => {
            try {
                // Get pid and hash from URL parameters
                const urlParams = new URLSearchParams(window.location.search);
                const pid = urlParams.get('pid') || 'default-pid';
                const hash = urlParams.get('hash') || 'default-hash';

                const [eventsResp, stagesResp, eventAccessResp] = await Promise.all([
                    getAllTableItems('events', pid, hash),
                    getAllTableItems('stages', pid, hash),
                    authGetConfigValue(pid, hash, 'eventAccess')
                ]);

                // Handle event access
                if (Array.isArray(eventAccessResp)) {
                    setUserEventAccess(eventAccessResp);
                    addDebugLog(`User event access: ${eventAccessResp.join(', ')}`);
                } else {
                    setUserEventAccess([]);
                    addDebugLog('No event access restrictions found, showing no events');
                }

                // Filter events based on user's event access list
                let filteredEvents: Array<{ aid: string; name: string; config?: { emailManager?: boolean }; subEvents?: Record<string, SubEvent> }> = [];
                if (Array.isArray(eventsResp)) {
                    if (userEventAccess.length > 0 && !userEventAccess.includes('all')) {
                        // If user has specific event access (not 'all'), filter by those events
                        filteredEvents = eventsResp.filter((ev) => userEventAccess.includes(ev.aid));
                    } else if (userEventAccess.includes('all')) {
                        // If user has 'all' access, show all events
                        filteredEvents = eventsResp;
                    } else {
                        // If no event access configured, show no events
                        filteredEvents = [];
                    }
                }
                setEvents(filteredEvents);
                setStages(Array.isArray(stagesResp) ? stagesResp : []);

                addDebugLog(`Loaded ${filteredEvents.length} events and ${Array.isArray(stagesResp) ? stagesResp.length : 0} stages`);

                // Log stages with parentStages
                const stagesWithParent = Array.isArray(stagesResp) ? stagesResp.filter((s) => s.parentStages && s.parentStages.length > 0) : [];
                addDebugLog(`Found ${stagesWithParent.length} stages with parentStages: ${stagesWithParent.map((s) => s.stage).join(', ')}`);

            } catch (error) {
                // Handle AUTH_UNKNOWN_CONFIG_KEY and other errors gracefully
                if (error.message && error.message.includes('AUTH_UNKNOWN_CONFIG_KEY')) {
                    addDebugLog('Event access not configured for user, showing no events');
                } else {
                    addDebugLog(`Error loading data: ${error}`);
                }
                setUserEventAccess([]);
                setEvents([]);
                toast.error('Failed to load data');
            }
        };

        loadData();
    }, [userEventAccess]);

    useEffect(() => {
        if (eventCode) {
            const selectedEvent = events.find(ev => ev.aid === eventCode);
            if (selectedEvent) {
                const subEvNames = selectedEvent.subEvents ? Object.keys(selectedEvent.subEvents) : [];
                setSubEvents(subEvNames);
                addDebugLog(`Event ${eventCode} has sub-events: ${subEvNames.join(', ')}`);
            }
        }
    }, [eventCode, events]);

    const handleStageChange = async (newStage: string) => {
        addDebugLog(`Stage selection changed to: ${newStage}`);

        if (!newStage) {
            setSelectedStage('');
            return;
        }

        const stageRecord = stages.find(s => s.stage === newStage);
        addDebugLog(`Found stage record: ${JSON.stringify(stageRecord)}`);

        if (stageRecord?.parentStages && stageRecord.parentStages.length > 0 && eventCode && subEvent) {
            addDebugLog(`Stage has parentStages: ${stageRecord.parentStages.join(', ')}, validating...`);

            try {
                // Note: handleFindParentWorkOrder is not implemented in the new API
                // For now, we'll skip this validation and proceed with stage selection
                addDebugLog('Parent work order validation not implemented in new API - proceeding with stage selection');
                setSelectedStage(newStage);
                toast.success(`Stage '${newStage}' selected (parent validation skipped)`);
            } catch (error) {
                addDebugLog(`Error finding parent work order: ${error}`);
                toast.error(`Error finding parent work order for stages: ${stageRecord.parentStages.join(', ')}`);
            }
        } else {
            addDebugLog('No parent stages required, proceeding normally');
            setSelectedStage(newStage);
        }
    };

    return (
        <Container className="py-4 bg-dark text-light min-vh-100">
            <h1 className="mb-4">Parent Stage Validation Test</h1>

            <Form>
                <Form.Group className="mb-3">
                    <Form.Label>Event Code</Form.Label>
                    <Form.Select
                        value={eventCode}
                        onChange={e => setEventCode(e.target.value)}
                        className="bg-dark text-light border-secondary"
                    >
                        <option value="">Select event</option>
                        {events.map(ev => (
                            <option key={ev.aid} value={ev.aid}>{ev.aid} - {ev.name}</option>
                        ))}
                    </Form.Select>
                </Form.Group>

                <Form.Group className="mb-3">
                    <Form.Label>Sub Event</Form.Label>
                    <Form.Select
                        value={subEvent}
                        onChange={e => setSubEvent(e.target.value)}
                        className="bg-dark text-light border-secondary"
                    >
                        <option value="">Select sub-event</option>
                        {subEvents.map(subEv => (
                            <option key={subEv} value={subEv}>{subEv}</option>
                        ))}
                    </Form.Select>
                </Form.Group>

                <Form.Group className="mb-3">
                    <Form.Label>Stage</Form.Label>
                    <Form.Select
                        value={selectedStage}
                        onChange={e => handleStageChange(e.target.value)}
                        className="bg-dark text-light border-secondary"
                    >
                        <option value="">Select Stage</option>
                        {stages.map(st => (
                            <option key={st.stage} value={st.stage}>
                                {st.order ? `[${st.order}] ` : ''}{st.stage} - {st.description}
                                {st.parentStages && st.parentStages.length > 0 ? ` (parents: ${st.parentStages.join(', ')})` : ''}
                            </option>
                        ))}
                    </Form.Select>
                </Form.Group>
            </Form>

            <div className="mt-4">
                <h3>Debug Log</h3>
                <div className="bg-dark border border-secondary p-3" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {debugLog.map((log, index) => (
                        <div key={index} className="text-muted small mb-1">{log}</div>
                    ))}
                </div>
            </div>

            <div className="mt-4">
                <h3>Current State</h3>
                <div className="bg-dark border border-secondary p-3">
                    <div><strong>Event Code:</strong> {eventCode || 'None'}</div>
                    <div><strong>Sub Event:</strong> {subEvent || 'None'}</div>
                    <div><strong>Selected Stage:</strong> {selectedStage || 'None'}</div>
                    <div><strong>Stages with parentStages:</strong> {stages.filter(s => s.parentStages && s.parentStages.length > 0).map(s => s.stage).join(', ') || 'None'}</div>
                </div>
            </div>
        </Container>
    );
} 