"use client";
import React, { useState, useEffect } from 'react';
import { Container, Form, Button, Alert } from 'react-bootstrap';
import { toast } from 'react-toastify';
import { callDbApi } from '@dharma/shared/src/clientApi';

export default function TestValidationPage() {
    const [events, setEvents] = useState<any[]>([]);
    const [stages, setStages] = useState<any[]>([]);
    const [eventCode, setEventCode] = useState('');
    const [subEvent, setSubEvent] = useState('');
    const [selectedStage, setSelectedStage] = useState('');
    const [subEvents, setSubEvents] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [debugLog, setDebugLog] = useState<string[]>([]);

    const addDebugLog = (message: string) => {
        setDebugLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    };

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const [eventsResp, stagesResp] = await Promise.all([
                    callDbApi('getEvents', {}),
                    callDbApi('getStages', {})
                ]);

                const filteredEvents = (eventsResp || []).filter((ev: any) => ev.config && ev.config.emailManager);
                setEvents(filteredEvents);
                setStages(stagesResp?.stages || []);

                addDebugLog(`Loaded ${filteredEvents.length} events and ${stagesResp?.stages?.length || 0} stages`);

                // Log stages with parentStage
                const stagesWithParent = stagesResp?.stages?.filter((s: any) => s.parentStage) || [];
                addDebugLog(`Found ${stagesWithParent.length} stages with parentStage: ${stagesWithParent.map((s: any) => s.stage).join(', ')}`);

            } catch (error) {
                addDebugLog(`Error loading data: ${error}`);
                toast.error('Failed to load data');
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, []);

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

        if (stageRecord?.parentStage && eventCode && subEvent) {
            addDebugLog(`Stage has parentStage: ${stageRecord.parentStage}, validating...`);

            try {
                const parentWorkOrder = await callDbApi('handleFindParentWorkOrder', {
                    eventCode,
                    subEvent,
                    parentStage: stageRecord.parentStage
                });

                addDebugLog(`Parent work order result: ${parentWorkOrder ? 'FOUND' : 'NOT FOUND'}`);

                if (parentWorkOrder) {
                    addDebugLog('Parent work order found, proceeding with stage selection');
                    setSelectedStage(newStage);
                    toast.success(`Parent work order found for stage '${stageRecord.parentStage}'`);
                } else {
                    addDebugLog('Parent work order NOT found, showing error');
                    toast.error(`Parent work order not found for stage '${stageRecord.parentStage}'. Cannot use stage '${newStage}'.`);
                    // Don't set the stage - keep current selection
                }
            } catch (error) {
                addDebugLog(`Error finding parent work order: ${error}`);
                toast.error(`Error finding parent work order for stage '${stageRecord.parentStage}'`);
            }
        } else {
            addDebugLog('No parent stage required, proceeding normally');
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
                                {st.parentStage ? ` (parent: ${st.parentStage})` : ''}
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
                    <div><strong>Stages with parentStage:</strong> {stages.filter(s => s.parentStage).map(s => s.stage).join(', ') || 'None'}</div>
                </div>
            </div>
        </Container>
    );
} 