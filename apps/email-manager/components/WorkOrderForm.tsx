import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Form, Button, Spinner, Card, Badge } from 'react-bootstrap'
import { toast } from 'react-toastify'
import { callDbApi } from '@dharma/shared/src/clientApi'

interface WorkOrderFormProps {
    id?: string
    onSave: () => void
    onCancel: () => void
    userPid: string
}

export default function WorkOrderForm({ id, onSave, onCancel, userPid }: WorkOrderFormProps) {
    const [loading, setLoading] = useState(false)
    const [events, setEvents] = useState<any[]>([])
    const [eventCode, setEventCode] = useState('')
    const [subEvents, setSubEvents] = useState<string[]>([])
    const [subEvent, setSubEvent] = useState('')
    const [stageList, setStageList] = useState<string[]>([])
    const [stage, setStage] = useState('')
    const [languageList, setLanguageList] = useState<string[]>([])
    const [languages, setLanguages] = useState<{ [key: string]: boolean }>({})
    const [subjects, setSubjects] = useState<{ [lang: string]: string }>({})
    const [accountList, setAccountList] = useState<string[]>([])
    const [account, setAccount] = useState('')
    const [zoomId, setZoomId] = useState('')
    const [inPerson, setInPerson] = useState(false)
    const [optionsLoaded, setOptionsLoaded] = useState(false)
    const [testers, setTesters] = useState<string[]>([])
    const [sendContinuously, setSendContinuously] = useState(false)
    const [sendUntil, setSendUntil] = useState('')
    const [sendInterval, setSendInterval] = useState(process.env.EMAIL_CONTINUOUS_SLEEP_SECS || '600')
    const [salutationByName, setSalutationByName] = useState(true)  // Default to true
    const [regLinkPresent, setRegLinkPresent] = useState(true)  // Default to true
    const [testParticipantOptions, setTestParticipantOptions] = useState<Array<{ id: string, name: string }>>([])
    const [stages, setStages] = useState<Array<{ stage: string, description: string, order?: number, parentStage?: string }>>([])
    const [selectedStageRecord, setSelectedStageRecord] = useState<any>(null)
    const [inheritedFields, setInheritedFields] = useState<{ s3HTMLPaths?: any, languages?: any, subjects?: any }>({})
    const [stageValidating, setStageValidating] = useState(false)
    const loadedSubEventRef = useRef<string | null>(null)
    const loadedWorkOrderRef = useRef<any>(null)
    const lastValidationRef = useRef<{ eventCode: string, subEvent: string, stage: string } | null>(null)
    const attemptedStageRef = useRef<string>('')

    // Fetch events and config on mount
    useEffect(() => {
        setLoading(true)
        Promise.all([
            callDbApi('getEvents', {}),
            callDbApi('getConfig', { key: 'emailAccountList' }),
            callDbApi('getStages', {}),
            callDbApi('getConfig', { key: 'emailLanguageList' }),
            callDbApi('getConfig', { key: 'emailTestIDs' })
        ]).then(([eventsResp, accountResp, stagesResp, langResp, testIDsResp]) => {
            // Only show events with config.emailManager === true
            const filteredEvents = (eventsResp || []).filter((ev: any) => ev.config && ev.config.emailManager)
            setEvents(filteredEvents)
            setAccountList(accountResp?.value || [])
            setStages(stagesResp?.stages || [])
            setLanguageList(langResp?.value || [])

            // Load test participant names
            const testIDs = testIDsResp?.value || []
            const loadTestParticipantNames = async () => {
                const options: Array<{ id: string, name: string }> = []
                for (const testID of testIDs) {
                    try {
                        const participant = await callDbApi('handleFindParticipant', { id: testID })
                        if (participant && (participant.first || participant.last)) {
                            options.push({
                                id: testID,
                                name: `${participant.first || ''} ${participant.last || ''}`.trim()
                            })
                        } else {
                            options.push({ id: testID, name: testID })
                        }
                    } catch (err) {
                        options.push({ id: testID, name: testID })
                    }
                }
                setTestParticipantOptions(options)
            }
            loadTestParticipantNames()

            if (!id) {
                setEventCode('') // No event selected by default
                setSubEvents([])
                setSubEvent('')
                setAccount('')
                setStage('')
                setLanguages({})
                setSubjects({})
            }
            setOptionsLoaded(true)
        }).catch((err) => {
            toast.error('Failed to load form options')
            setOptionsLoaded(true)
        }).finally(() => setLoading(false))
    }, [])

    // Load work order if editing, but only after options are loaded
    useEffect(() => {
        if (id) {
            callDbApi('handleGetWorkOrder', { id }).then(response => {
                loadedWorkOrderRef.current = response
                if (optionsLoaded) {
                    setEventCode(response.eventCode)
                    loadedSubEventRef.current = response.subEvent
                    setStage(response.stage)
                    setSubjects(response.subjects || {})
                    setAccount(response.account)
                    setLanguages(response.languages || {})
                    setZoomId(response.zoomId || '')
                    setInPerson(response.inPerson || false)
                    setTesters(response.testers || [])
                    setSendContinuously(response.sendContinuously || false)
                    setSendUntil(response.sendUntil || '')
                    setSendInterval(response.sendInterval || process.env.EMAIL_CONTINUOUS_SLEEP_SECS || '600')
                    setSalutationByName(response.salutationByName !== false)  // Default to true if not explicitly false
                    setRegLinkPresent(response.regLinkPresent !== false)  // Default to true if not explicitly false
                }
            }).catch(error => {
                console.error('Error loading work order:', error)
                toast.error('Failed to load work order')
            })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    // When optionsLoaded becomes true, set form state from loaded work order if present
    useEffect(() => {
        if (optionsLoaded && loadedWorkOrderRef.current) {
            const response = loadedWorkOrderRef.current
            setEventCode(response.eventCode)
            loadedSubEventRef.current = response.subEvent
            setStage(response.stage)
            setSubjects(response.subjects || {})
            setAccount(response.account)
            setLanguages(response.languages || {})
            setZoomId(response.zoomId || '')
            setInPerson(response.inPerson || false)
            setTesters(response.testers || [])
            setSendContinuously(response.sendContinuously || false)
            setSendUntil(response.sendUntil || '')
            setSendInterval(response.sendInterval || process.env.EMAIL_CONTINUOUS_SLEEP_SECS || '600')
            setSalutationByName(response.salutationByName !== false)  // Default to true if not explicitly false
            setRegLinkPresent(response.regLinkPresent !== false)  // Default to true if not explicitly false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [optionsLoaded])

    // Update sub-events when event changes
    useEffect(() => {
        const selectedEvent = events.find(ev => ev.aid === eventCode)
        if (selectedEvent) {
            const subEvNames = selectedEvent.subEvents ? Object.keys(selectedEvent.subEvents) : []
            setSubEvents(subEvNames)

            // Check if this event is in-person
            const isInPersonEvent = selectedEvent.config && selectedEvent.config.inPerson === true
            setInPerson(isInPersonEvent)

            // Only set subEvent if loading from edit and the value is present in the new options
            if (loadedSubEventRef.current && subEvNames.includes(loadedSubEventRef.current)) {
                setSubEvent(loadedSubEventRef.current)
                loadedSubEventRef.current = null
            } else if (!id && subEvNames.length === 1) {
                setSubEvent(subEvNames[0])
            } else if (!id) {
                setSubEvent('')
            } else if (id && !subEvNames.includes(subEvent)) {
                setSubEvent('')
            }
        } else {
            setSubEvents([])
            setSubEvent('')
            setInPerson(false)
        }
    }, [eventCode, events])

    // Re-validate parent stage when eventCode or subEvent changes
    useEffect(() => {
        if (stage && selectedStageRecord?.parentStage && eventCode && subEvent) {
            const currentValidation = { eventCode, subEvent, stage }
            const lastValidation = lastValidationRef.current

            // Only re-validate if the event/sub-event combination has actually changed
            if (!lastValidation ||
                lastValidation.eventCode !== eventCode ||
                lastValidation.subEvent !== subEvent) {
                lastValidationRef.current = currentValidation
                handleStageChange(stage)
            }
        }
    }, [eventCode, subEvent])

    // New function to handle stage selection with immediate validation
    const handleStageChange = async (newStage: string) => {
        // Store the attempted stage selection
        attemptedStageRef.current = newStage;

        if (!newStage) {
            setStage('')
            setSelectedStageRecord(null)
            setInheritedFields({})
            return
        }

        const stageRecord = stages.find(s => s.stage === newStage)

        // If stage has parentStage, validate immediately before setting
        if (stageRecord?.parentStage && eventCode && subEvent) {
            setStageValidating(true)
            try {
                const parentWorkOrder = await callDbApi('handleFindParentWorkOrder', {
                    eventCode,
                    subEvent,
                    parentStage: stageRecord.parentStage
                })

                if (parentWorkOrder) {
                    // Parent work order found, proceed with stage selection
                    setStage(newStage)
                    setSelectedStageRecord(stageRecord)
                    setInheritedFields({
                        s3HTMLPaths: parentWorkOrder.s3HTMLPaths,
                        languages: parentWorkOrder.languages,
                        subjects: parentWorkOrder.subjects
                    })

                    // Update last validation ref
                    lastValidationRef.current = { eventCode, subEvent, stage: newStage }

                    // Auto-populate inherited fields if not already set
                    if (!Object.keys(languages).length && parentWorkOrder.languages) {
                        setLanguages(parentWorkOrder.languages)
                    }
                    if (!Object.keys(subjects).length && parentWorkOrder.subjects) {
                        setSubjects(parentWorkOrder.subjects)
                    }
                } else {
                    // Parent work order not found, show error and don't set stage
                    toast.error(`Parent work order not found for stage '${stageRecord.parentStage}'. Cannot use stage '${newStage}'.`)
                    // Don't set the stage - keep current selection
                    // Reset the attempted stage ref since validation failed
                    attemptedStageRef.current = stage;
                }
            } catch (error) {
                console.error('Error finding parent work order:', error)
                toast.error(`Error finding parent work order for stage '${stageRecord.parentStage}'`)
                // Don't set the stage - keep current selection
                // Reset the attempted stage ref since validation failed
                attemptedStageRef.current = stage;
            } finally {
                setStageValidating(false)
            }
        } else {
            // No parent stage, proceed normally
            setStage(newStage)
            setSelectedStageRecord(stageRecord)
            setInheritedFields({})
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        // Validate zoomId is present if qaStepCheckZoomId is enabled (only if not in-person)
        if (selectedStageRecord?.qaStepCheckZoomId && !inPerson && !zoomId) {
            toast.error('Zoom ID is required for this stage')
            return
        }

        setLoading(true)
        try {
            // Get the selected event to extract pool configuration
            const selectedEvent = events.find(ev => ev.aid === eventCode)
            const pool = selectedEvent?.config?.pool || ''

            const steps = [
                {
                    name: 'Count',
                    status: 'ready',
                    message: '',
                    isActive: false
                },
                {
                    name: 'Prepare',
                    status: 'ready',
                    message: '',
                    isActive: false
                },
                {
                    name: 'Dry-Run',
                    status: 'ready',
                    message: '',
                    isActive: false
                },
                {
                    name: 'Test',
                    status: 'ready',
                    message: '',
                    isActive: false
                },
                {
                    name: 'Send',
                    status: 'ready',
                    message: '',
                    isActive: false
                }
            ];

            const workOrder = {
                eventCode,
                subEvent,
                stage,
                languages,
                subjects,
                account,
                zoomId: selectedStageRecord?.qaStepCheckZoomId && !inPerson ? zoomId : undefined,
                inPerson: inPerson ? true : false,
                testers,
                sendContinuously,
                sendUntil: sendContinuously ? sendUntil : undefined,
                sendInterval: sendContinuously ? sendInterval : undefined,
                salutationByName,
                regLinkPresent,
                createdBy: userPid,
                config: {
                    pool: pool
                },
                // Inherit s3HTMLPaths from parent if available
                s3HTMLPaths: inheritedFields.s3HTMLPaths,
                steps: steps
            }

            if (id) {
                await callDbApi('handleUpdateWorkOrder', {
                    id,
                    userPid,
                    updates: workOrder
                })
                toast.success('Work order updated')
            } else {
                await callDbApi('handleCreateWorkOrder', workOrder)
                toast.success('Work order created')
            }

            onSave()
        } catch (err) {
            toast.error('Failed to save work order')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Form onSubmit={handleSubmit} className="text-light">
            <div className="d-flex justify-content-between align-items-center mb-3">
                {id && (
                    <Button
                        variant="danger"
                        onClick={async () => {
                            if (window.confirm('Are you sure you want to delete this work order?')) {
                                setLoading(true)
                                try {
                                    await callDbApi('handleDeleteWorkOrder', { id })
                                    toast.success('Work order deleted')
                                    onSave()
                                } catch (err) {
                                    toast.error('Failed to delete work order')
                                } finally {
                                    setLoading(false)
                                }
                            }
                        }}
                        style={{ borderRadius: '50%', width: 40, height: 40, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}
                        aria-label="Delete Work Order"
                        disabled={loading}
                    >
                        &#128465;
                    </Button>
                )}
                <div className="d-flex gap-2 align-items-center">
                    <Button variant="secondary" onClick={onCancel} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="primary" type="submit" disabled={loading}>
                        {loading ? (
                            <>
                                <Spinner
                                    as="span"
                                    animation="border"
                                    size="sm"
                                    role="status"
                                    aria-hidden="true"
                                    className="me-2"
                                />
                                Saving...
                            </>
                        ) : (
                            'Save'
                        )}
                    </Button>
                </div>
            </div>
            <Form.Group className="mb-3">
                <Form.Label>Event Code</Form.Label>
                <Form.Select
                    value={eventCode}
                    onChange={e => setEventCode(e.target.value)}
                    required
                    className="bg-dark text-light border-secondary"
                >
                    <option value="" disabled>Select event</option>
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
                    required
                    disabled={subEvents.length === 1}
                    className="bg-dark text-light border-secondary"
                >
                    {subEvents.length !== 1 && <option value="" disabled>Select sub-event</option>}
                    {subEvents.map(subEv => (
                        <option key={subEv} value={subEv}>{subEv}</option>
                    ))}
                </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Stage</Form.Label>
                <Form.Select
                    value={stageValidating ? attemptedStageRef.current : stage}
                    onChange={e => handleStageChange(e.target.value)}
                    required
                    disabled={stageValidating}
                    className="bg-dark text-light border-secondary"
                >
                    <option value="">Select Stage</option>
                    {stages.map(st => (
                        <option key={st.stage} value={st.stage}>
                            {st.order ? `[${st.order}] ` : ''}{st.stage} - {st.description}
                        </option>
                    ))}
                </Form.Select>
                {stageValidating && (
                    <Form.Text className="text-info">
                        <Spinner
                            as="span"
                            animation="border"
                            size="sm"
                            role="status"
                            aria-hidden="true"
                            className="me-2"
                        />
                        Validating parent stage...
                    </Form.Text>
                )}
                {selectedStageRecord?.parentStage && (
                    <Form.Text className="text-info">
                        This stage inherits content from parent stage: {selectedStageRecord.parentStage}
                    </Form.Text>
                )}
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Languages</Form.Label>
                <div className="d-flex flex-wrap gap-3">
                    {languageList.map(lang => (
                        <Form.Check
                            key={lang}
                            type="checkbox"
                            id={`lang-${lang}`}
                            label={lang}
                            checked={!!languages[lang]}
                            onChange={e => setLanguages(langs => ({ ...langs, [lang]: e.target.checked }))}
                            disabled={selectedStageRecord?.parentStage}
                            className="bg-dark text-light border-secondary"
                        />
                    ))}
                </div>
                {selectedStageRecord?.parentStage && (
                    <Form.Text className="text-info">
                        Languages are inherited from parent stage and cannot be modified
                    </Form.Text>
                )}
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Subjects</Form.Label>
                {Object.keys(languages).filter(l => languages[l]).map(lang => (
                    <div key={lang} className="mb-2">
                        <Form.Label>{lang.toUpperCase()}</Form.Label>
                        <Form.Control
                            type="text"
                            value={subjects[lang] || ''}
                            onChange={e => setSubjects(s => ({ ...s, [lang]: e.target.value }))}
                            placeholder={`Subject for ${lang.toUpperCase()}`}
                            disabled={selectedStageRecord?.parentStage}
                            className="bg-dark text-light border-secondary mb-2"
                        />
                    </div>
                ))}
                {selectedStageRecord?.parentStage && (
                    <Form.Text className="text-info">
                        Subjects are inherited from parent stage and cannot be modified
                    </Form.Text>
                )}
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Label>Account</Form.Label>
                <Form.Select
                    value={account}
                    onChange={e => setAccount(e.target.value)}
                    required
                    className="bg-dark text-light border-secondary"
                >
                    <option value="" disabled>Select account</option>
                    {accountList.map(acc => (
                        <option key={acc} value={acc}>{acc}</option>
                    ))}
                </Form.Select>
            </Form.Group>

            {selectedStageRecord?.qaStepCheckZoomId && (
                <Form.Group className="mb-3">
                    {inPerson ? (
                        <>
                            <Form.Label>Event Type</Form.Label>
                            <div className="form-control bg-dark text-light border-secondary" style={{ padding: '0.375rem 0.75rem', backgroundColor: '#212529', color: '#fff' }}>
                                <Badge bg="success" className="me-2">In-Person</Badge>
                                This is an in-person event - no Zoom ID required
                            </div>
                        </>
                    ) : (
                        <>
                            <Form.Label>Zoom ID</Form.Label>
                            <Form.Control
                                type="text"
                                value={zoomId}
                                onChange={e => setZoomId(e.target.value)}
                                placeholder="Enter Zoom ID"
                                className="bg-dark text-light border-secondary"
                                required
                            />
                            <Form.Text className="text-muted">
                                Required for this stage
                            </Form.Text>
                        </>
                    )}
                </Form.Group>
            )}

            <Form.Group className="mb-3">
                <Form.Label>Testers</Form.Label>
                <Form.Select
                    multiple
                    value={testers}
                    onChange={e => {
                        const selectedOptions = Array.from(e.target.selectedOptions, option => option.value)
                        setTesters(selectedOptions)
                    }}
                    className="bg-dark text-light border-secondary"
                >
                    {testParticipantOptions.map(option => (
                        <option key={option.id} value={option.id}>
                            {option.name}
                        </option>
                    ))}
                </Form.Select>
                <Form.Text className="text-muted">
                    Select one or more testers to receive test emails (hold Ctrl/Cmd to select multiple)
                </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Check
                    type="checkbox"
                    id="salutationByName"
                    label="Salutation By Name"
                    checked={salutationByName}
                    onChange={e => setSalutationByName(e.target.checked)}
                    className="bg-dark text-light border-secondary"
                />
                <Form.Text className="text-muted">
                    When enabled, the Prepare step will check for the ||name|| field in HTML content
                </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Check
                    type="checkbox"
                    id="regLinkPresent"
                    label="Registration Link Present"
                    checked={regLinkPresent}
                    onChange={e => setRegLinkPresent(e.target.checked)}
                    className="bg-dark text-light border-secondary"
                />
                <Form.Text className="text-muted">
                    When enabled, the Prepare step will check for registration links with proper parameters
                </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
                <Form.Check
                    type="checkbox"
                    id="sendContinuously"
                    label="Enable Continuous Sending"
                    checked={sendContinuously}
                    onChange={e => setSendContinuously(e.target.checked)}
                    className="bg-dark text-light border-secondary"
                />
                <Form.Text className="text-muted">
                    When enabled, emails will be sent continuously until the specified date
                </Form.Text>
            </Form.Group>

            {sendContinuously && (
                <Form.Group className="mb-3">
                    <Form.Label>Send Until Date</Form.Label>
                    <Form.Control
                        type="datetime-local"
                        value={sendUntil}
                        onChange={e => setSendUntil(e.target.value)}
                        className="bg-dark text-light border-secondary"
                        required={sendContinuously}
                    />
                    <Form.Text className="text-muted">
                        Continuous sending will stop on this date and time
                    </Form.Text>
                </Form.Group>
            )}

            {sendContinuously && (
                <Form.Group className="mb-3">
                    <Form.Label>Send Interval</Form.Label>
                    <Form.Select
                        value={sendInterval}
                        onChange={e => setSendInterval(e.target.value)}
                        className="bg-dark text-light border-secondary"
                        required={sendContinuously}
                    >
                        <option value="3600">1 hour</option>
                        <option value="600">10 minutes</option>
                    </Form.Select>
                    <Form.Text className="text-muted">
                        Time to wait between sending passes
                    </Form.Text>
                </Form.Group>
            )}
        </Form>
    )
} 