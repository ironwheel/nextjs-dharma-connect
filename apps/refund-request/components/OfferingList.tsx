import React, { useState, useEffect } from 'react';
import { Button, Card, Table, Form, Modal, Spinner, Badge } from 'react-bootstrap';
import { getTableItemOrNull, api, authGetConfigValue } from 'sharedFrontend';
import { toast } from 'react-toastify';


interface OfferingListProps {
    student: any;
}

const OfferingList: React.FC<OfferingListProps> = ({ student }) => {
    const [processing, setProcessing] = useState<string | null>(null);
    const [eventsData, setEventsData] = useState<Record<string, any>>({}); // Store full event objects
    const [filterTerm, setFilterTerm] = useState('');
    const [creds, setCreds] = useState<{ pid: string, hash: string } | null>(null);

    // Add state for modal
    // Add state for modal
    const [showRefundModal, setShowRefundModal] = useState(false);
    const [refundCandidate, setRefundCandidate] = useState<any | null>(null);
    const [stripeDetailsMap, setStripeDetailsMap] = useState<Record<string, any>>({});
    const [loadingStripe, setLoadingStripe] = useState(false);
    const [reason, setReason] = useState('');
    const [refundRequests, setRefundRequests] = useState<Record<string, { approvalState: string, approverName?: string }>>({});
    const [userEventAccess, setUserEventAccess] = useState<string[]>([]);

    // Refund Logic State
    const [selectedRefundItems, setSelectedRefundItems] = useState<Set<string>>(new Set());
    const [refundAmounts, setRefundAmounts] = useState<Record<string, number>>({});
    const [customAmounts, setCustomAmounts] = useState<Record<string, boolean>>({}); // Track if user unchecked "Full Refund"

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const pid = urlParams.get('pid');
        const hash = urlParams.get('hash');
        if (pid && hash) {
            setCreds({ pid, hash });
        }
    }, []);

    // 1. Initial Extraction (Raw Data)
    // 1. Initial Extraction (Raw Data)
    const extractOfferings = () => {
        const offerings: any[] = [];
        if (!student.programs) return offerings;

        const lookbackDate = new Date();
        lookbackDate.setMonth(lookbackDate.getMonth() - 12);

        Object.entries(student.programs).forEach(([progId, progData]: [string, any]) => {
            if (progData.offeringHistory) {
                Object.entries(progData.offeringHistory).forEach(([eventId, offData]: [string, any]) => {
                    const offeringDate = offData.offeringTime ? new Date(offData.offeringTime) : null;

                    if (offeringDate && offeringDate >= lookbackDate) {
                        const refundItems: any[] = [];

                        // Handle Installments Pattern
                        if (offData.installments) {
                            Object.entries(offData.installments).forEach(([key, instData]: [string, any]) => {
                                if (instData.offeringIntent) {
                                    refundItems.push({
                                        offeringIntent: instData.offeringIntent,
                                        offeringSKU: instData.offeringSKU,
                                        offeringAmount: instData.offeringAmount,
                                        label: key.charAt(0).toUpperCase() + key.slice(1) // e.g. "Balance"
                                    });
                                }
                            });
                        }
                        // Handle standard pattern
                        else if (offData.offeringIntent) {
                            refundItems.push({
                                offeringIntent: offData.offeringIntent,
                                offeringSKU: offData.offeringSKU,
                                offeringAmount: offData.offeringAmount, // Might be undefined
                                label: 'Full Payment'
                            });
                        }

                        offerings.push({
                            programId: progId,
                            eventId: eventId,
                            ...offData,
                            refundItems // Attach normalized refund items
                        });
                    }
                });
            }
        });
        return offerings;
    };

    const rawOfferings = extractOfferings();

    // 2. Fetch Event Metadata & Check Existing Refunds
    useEffect(() => {
        if (!creds || rawOfferings.length === 0) return;

        const fetchEvents = async () => {
            const uniqueProgramIds = Array.from(new Set(rawOfferings.map(o => o.programId)));
            const newEventsData: Record<string, any> = { ...eventsData };

            let changed = false;
            for (const progId of uniqueProgramIds) {
                if (!newEventsData[progId]) {
                    try {
                        const event = await getTableItemOrNull('events', progId, creds.pid, creds.hash);
                        if (event) {
                            newEventsData[progId] = event;
                            changed = true;
                        } else {
                            newEventsData[progId] = { name: progId, notFound: true };
                            changed = true;
                        }
                    } catch (e) {
                        newEventsData[progId] = { name: progId, error: true };
                        changed = true;
                    }
                }
            }
            if (changed) setEventsData(newEventsData);
        };

        const checkRefunds = async () => {
            // Collect all unique intents from all refundItems
            const allIntents = rawOfferings.flatMap(o => o.refundItems?.map((ri: any) => ri.offeringIntent) || []).filter(Boolean);
            const uniqueIntents = Array.from(new Set(allIntents));

            if (uniqueIntents.length === 0) return;
            try {
                const res = await api.post('/api/refunds/check', creds.pid, creds.hash, { paymentIntentIds: uniqueIntents });
                setRefundRequests(res.refundRequests || {});
            } catch (e) {
                console.error("Failed to check existing refunds", e);
            }
        };

        const fetchEventAccess = async () => {
            try {
                const eventAccessResult = await authGetConfigValue(creds.pid, creds.hash, 'eventAccess');
                if (Array.isArray(eventAccessResult)) {
                    setUserEventAccess(eventAccessResult);
                } else {
                    console.log('No event access restrictions found (or invalid format), showing no events');
                    setUserEventAccess([]);
                }
            } catch (error: any) {
                if (error.message && error.message.includes('AUTH_UNKNOWN_CONFIG_KEY')) {
                    console.log('Event access not configured for user, showing no events');
                } else {
                    console.error('Error fetching event access:', error);
                }
                setUserEventAccess([]);
            }
        };

        fetchEvents();
        checkRefunds();
        fetchEventAccess();
    }, [student, creds]); // rawOfferings derived from student, so implicit dependency

    // 3. Process, Enrich, Filter, and Sort Offerings
    const processOfferings = () => {
        const enriched = rawOfferings.map(off => {
            const eventData = eventsData[off.programId];
            const eventName = eventData?.name || off.programId;

            // Extract Subevent Date
            let subEventDate = null;
            if (eventData && eventData.subEvents && eventData.subEvents[off.eventId] && eventData.subEvents[off.eventId].date) {
                subEventDate = eventData.subEvents[off.eventId].date;
            }

            return {
                ...off,
                eventName,
                subEventDate
            };
        });

        const filtered = enriched.filter(off => {
            // Event Access Logic
            if (!userEventAccess.includes('all')) {
                // If 'all' is not present, we must match the eventId (programId in this context usually map to aid)
                // In data model: off.programId seems to match event aid based on extraction login
                if (!userEventAccess.includes(off.programId)) {
                    return false;
                }
            }

            const searchLower = filterTerm.toLowerCase();
            return (
                (off.eventName && off.eventName.toLowerCase().includes(searchLower)) ||
                (off.eventId && off.eventId.toLowerCase().includes(searchLower)) ||
                (off.offeringSKU && off.offeringSKU.toLowerCase().includes(searchLower)) ||
                (off.offeringIntent && off.offeringIntent.toLowerCase().includes(searchLower))
            );
        });

        // Sort by Subevent Date (desc), fallback to Offering Date (desc)
        return filtered.sort((a, b) => {
            const dateStrA = a.subEventDate;
            const dateStrB = b.subEventDate;
            const timeA = dateStrA ? new Date(dateStrA).getTime() : (a.offeringTime ? new Date(a.offeringTime).getTime() : 0);
            const timeB = dateStrB ? new Date(dateStrB).getTime() : (b.offeringTime ? new Date(b.offeringTime).getTime() : 0);
            return timeB - timeA;
        });
    };

    const displayOfferings = processOfferings();

    const initiateRefund = async (offering: any) => {
        setRefundCandidate(offering);
        setStripeDetailsMap({});
        setLoadingStripe(true);
        setShowRefundModal(true);
        setReason(''); // Reset reason

        // Default selection: all items not already requested
        const initialUsage = new Set<string>();
        const initialCustom = {};

        const itemsToProcess = offering.refundItems || [];

        // Filter out items that already have requests?
        // User might want to see them but maybe disabled?
        // For now select all.
        itemsToProcess.forEach((item: any) => {
            // Only select if not already requested?
            if (!refundRequests[item.offeringIntent]) {
                initialUsage.add(item.offeringIntent);
            }
        });
        setSelectedRefundItems(initialUsage);
        setCustomAmounts({});
        setRefundAmounts({});

        // Fetch stripe details for all items
        if (itemsToProcess.length > 0) {
            try {
                if (creds) {
                    const promises = itemsToProcess.map(async (item: any) => {
                        try {
                            // Optimization: Check loop cache or multiple?
                            // Just parallel fetch for now.
                            const data = await api.get(`/api/stripe/retrieve?id=${item.offeringIntent}`, creds.pid, creds.hash);
                            return { id: item.offeringIntent, data };
                        } catch (e) {
                            console.error(`Failed to fetch stripe for ${item.offeringIntent}`, e);
                            return { id: item.offeringIntent, error: true };
                        }
                    });

                    const results = await Promise.all(promises);
                    const newMap: Record<string, any> = {};
                    const newAmounts: Record<string, number> = {};

                    results.forEach((res: any) => {
                        if (!res.error) {
                            newMap[res.id] = res.data;
                            // Initialize amount to full amount (in cents)
                            newAmounts[res.id] = res.data.amount;
                        } else {
                            // Fallback to local amount if available
                            const localItem = itemsToProcess.find((i: any) => i.offeringIntent === res.id);
                            if (localItem && localItem.offeringAmount) {
                                newAmounts[res.id] = localItem.offeringAmount * 100; // Assuming offeringAmount is dollars?
                                // Wait offeringAmount in data model is typically dollars? 
                                // Example: "offeringAmount": 350. Stripe "amount": 35000.
                                // We need to be careful with units.
                                // Let's assume input should be in dollars for user convenience?
                                // Or cents? Stripe uses cents.
                                // Let's store cents in state, display dollars.
                            }
                        }
                    });
                    setStripeDetailsMap(newMap);
                    setRefundAmounts(newAmounts);
                }
            } catch (error: any) {
                console.error("Failed to fetch stripe details", error);
                toast.error("Could not retrieve some transaction details.");
            } finally {
                setLoadingStripe(false);
            }
        } else {
            setLoadingStripe(false);
        }
    };

    const cancelRefund = () => {
        setRefundCandidate(null);
        setStripeDetailsMap({});
        setShowRefundModal(false);
    };

    const confirmRefund = async () => {
        if (!refundCandidate) return;

        if (reason.length < 10) {
            toast.error("Please provide a reason (at least 10 characters).");
            return;
        }

        const { programId, eventId } = refundCandidate;
        const itemsToProcess = Array.from(selectedRefundItems);

        if (itemsToProcess.length === 0) {
            toast.error("Please select at least one item to refund.");
            return;
        }

        // Set processing for the main offering (composite) 
        // Or should we track generic processing?
        // Using "installments" ID if available, or first ID?
        // The Action button uses off.offeringIntent.
        setProcessing(refundCandidate.offeringIntent || itemsToProcess[0]);

        if (!creds) return;

        let successCount = 0;
        let failCount = 0;

        for (const intentId of itemsToProcess) {
            const amount = refundAmounts[intentId];

            // Validate amount?
            // If customAmounts[intentId] is true, we must have a valid amount.

            try {
                await api.post('/api/refunds/request', creds.pid, creds.hash, {
                    stripePaymentIntent: intentId,
                    pid: student.id,
                    eventCode: programId,
                    subEvent: eventId,
                    reason,
                    refundAmount: amount // Send the amount (in cents)
                });
                successCount++;

                setRefundRequests((prev: Record<string, { approvalState: string, approverName?: string }>) => ({
                    ...prev,
                    [intentId]: { approvalState: 'PENDING' }
                }));
            } catch (err: any) {
                console.error(`Failed to request refund for ${intentId}`, err);
                failCount++;
                // Continue with others?
            }
        }

        if (successCount > 0) {
            toast.success(`Submitted ${successCount} refund request(s).`);
        }
        if (failCount > 0) {
            toast.error(`Failed to submit ${failCount} request(s).`);
        }

        setProcessing(null);
        if (failCount === 0) {
            setShowRefundModal(false);
            setRefundCandidate(null);
            setStripeDetailsMap({});
        }
    };

    return (
        <>
            <Card className="bg-dark text-white border-secondary">
                <Card.Header className="border-secondary d-flex justify-content-between align-items-center">
                    <span>Offering History for {student.first} {student.last}</span>
                    <Badge bg="secondary">{student.id}</Badge>
                </Card.Header>
                <Card.Body>
                    <Form.Group className="mb-3">
                        <Form.Control
                            type="text"
                            placeholder="Filter history..."
                            value={filterTerm}
                            onChange={e => setFilterTerm(e.target.value)}
                            className="bg-dark text-white border-secondary"
                        />
                    </Form.Group>

                    {displayOfferings.length === 0 ? (
                        <p className="text-muted">No matching offerings found.</p>
                    ) : (
                        <Table striped bordered hover size="sm" variant="dark">
                            <thead>
                                <tr>
                                    <th>Event</th>
                                    <th>Subevent</th>
                                    <th>Event Date</th>
                                    <th>Offering Time</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayOfferings.map((off, idx) => (
                                    <tr key={idx}>
                                        <td>
                                            {off.eventName}
                                            {off.eventName !== off.programId && (
                                                <div className="text-muted small" style={{ fontSize: '0.75em' }}>{off.programId}</div>
                                            )}
                                        </td>
                                        <td>
                                            {['event', 'retreat'].includes(off.eventId.toLowerCase()) ? '' : off.eventId}
                                        </td>
                                        <td>
                                            {(() => {
                                                if (!off.subEventDate) return '-';
                                                const [y, m, d] = off.subEventDate.split('-');
                                                if (!y || !m || !d) return off.subEventDate;
                                                const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                                                return `${d}-${months[parseInt(m, 10) - 1]}-${y}`;
                                            })()}
                                        </td>
                                        <td>{off.offeringTime || '-'}</td>
                                        <td>
                                            {(() => {
                                                const request = refundRequests[off.offeringIntent];
                                                if (request) {
                                                    if (request.approvalState === 'COMPLETE') {
                                                        return <Badge bg="success">Refunded by {request.approverName || 'Admin'}</Badge>;
                                                    }
                                                    if (request.approvalState === 'DENY' || request.approvalState === 'DENIED') {
                                                        return <Badge bg="danger">Denied by {request.approverName || 'Admin'}</Badge>;
                                                    }
                                                    if (request.approvalState === 'ERROR') {
                                                        return <Badge bg="danger">Error</Badge>;
                                                    }
                                                    // Default or PENDING
                                                    return <Button variant="secondary" size="sm" disabled>Request Pending</Button>;
                                                }

                                                if (off.offeringIntent) {
                                                    return (
                                                        <Button
                                                            variant="warning"
                                                            size="sm"
                                                            disabled={processing === off.offeringIntent}
                                                            onClick={() => initiateRefund(off)}
                                                        >
                                                            {processing === off.offeringIntent ? 'Processing...' : 'Request Refund'}
                                                        </Button>
                                                    );
                                                }

                                                return null;
                                            })()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Card.Body>
            </Card>

            <Modal show={showRefundModal} onHide={cancelRefund} size="lg" centered>
                <Modal.Header closeButton className="bg-dark text-white border-secondary">
                    <Modal.Title>Confirm Request</Modal.Title>
                </Modal.Header>
                <Modal.Body className="bg-dark text-white">
                    {refundCandidate && (
                        <div>
                            <p className="lead text-center">Please confirm the following refund details</p>
                            <div className="my-4 p-3 border border-secondary rounded bg-secondary bg-opacity-10">
                                <div className="mb-2"><strong>Student:</strong> {student.first} {student.last}</div>
                                <div className="mb-2"><strong>Email:</strong> {student.email}</div>
                                <div className="mb-2"><strong>Event:</strong> {refundCandidate.eventName}</div>
                                <div className="mb-2"><strong>Subevent:</strong> {refundCandidate.eventId}</div>

                                {loadingStripe ? (
                                    <div className="mb-2 text-info">
                                        <Spinner animation="border" size="sm" className="me-2" />
                                        Fetching transaction details...
                                    </div>
                                ) : (
                                    <>
                                        {(refundCandidate.refundItems || []).map((item: any) => {
                                            const intentId = item.offeringIntent;
                                            const details = stripeDetailsMap[intentId];
                                            const isSelected = selectedRefundItems.has(intentId);
                                            const isCustom = customAmounts[intentId];
                                            const amount = refundAmounts[intentId] || 0;
                                            const maxAmount = details ? details.amount : (item.offeringAmount ? item.offeringAmount * 100 : 0);
                                            const isPending = refundRequests[intentId]?.approvalState === 'PENDING';
                                            const isComplete = refundRequests[intentId]?.approvalState === 'COMPLETE';

                                            // If already processed/pending, maybe show status instead of inputs?
                                            if (isPending || isComplete) {
                                                return (
                                                    <div key={intentId} className="mb-3 p-2 border border-secondary rounded bg-dark">
                                                        <div className="d-flex justify-content-between">
                                                            <strong>{item.label}</strong>
                                                            <Badge bg={isComplete ? "success" : "warning"}>
                                                                {isComplete ? "Refunded" : "Request Pending"}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                );
                                            }

                                            return (
                                                <div key={intentId} className="mb-3 p-2 border border-secondary rounded">
                                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                                        <Form.Check
                                                            type="checkbox"
                                                            label={<strong>{item.label}</strong>}
                                                            checked={isSelected}
                                                            onChange={(e) => {
                                                                const newSet = new Set(selectedRefundItems);
                                                                if (e.target.checked) newSet.add(intentId);
                                                                else newSet.delete(intentId);
                                                                setSelectedRefundItems(newSet);
                                                            }}
                                                        />
                                                        {details && (
                                                            <span className="text-muted small">
                                                                Max: ${(maxAmount / 100).toFixed(2)} {details.currency.toUpperCase()}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {isSelected && (
                                                        <div className="ms-4">
                                                            <Form.Check
                                                                type="checkbox"
                                                                label="Full Refund"
                                                                checked={!isCustom}
                                                                onChange={(e) => {
                                                                    setCustomAmounts(prev => ({ ...prev, [intentId]: !e.target.checked }));
                                                                    if (e.target.checked) {
                                                                        // Reset to max
                                                                        setRefundAmounts(prev => ({ ...prev, [intentId]: maxAmount }));
                                                                    }
                                                                }}
                                                                className="mb-2 text-warning"
                                                            />

                                                            <Form.Control
                                                                type="number"
                                                                value={(amount / 100).toFixed(2)}
                                                                onChange={(e) => {
                                                                    const val = parseFloat(e.target.value);
                                                                    if (!isNaN(val)) {
                                                                        setRefundAmounts(prev => ({ ...prev, [intentId]: Math.round(val * 100) }));
                                                                    }
                                                                }}
                                                                disabled={!isCustom}
                                                                step="0.01"
                                                                className="bg-dark text-white border-secondary"
                                                            />
                                                            {details?.description && <div className="small text-muted mt-1">{details.description}</div>}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </>
                                )}
                            </div>

                            <Form.Group className="mb-3">
                                <Form.Label>Reason (Required)</Form.Label>
                                <Form.Control
                                    as="textarea"
                                    rows={3}
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Enter reason for refund request (min 10 chars)..."
                                    className="bg-secondary text-white border-secondary bg-opacity-25"
                                />
                            </Form.Group>

                            <p className="text-muted small fst-italic text-center">This action will submit a refund request for approval.</p>
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer className="bg-dark border-secondary">
                    <Button variant="secondary" onClick={cancelRefund}>
                        Cancel
                    </Button>
                    <Button variant="warning" onClick={confirmRefund} disabled={loadingStripe || selectedRefundItems.size === 0 || reason.length < 10}>
                        Confirm Request
                    </Button>
                </Modal.Footer>
            </Modal>
        </>
    );
};


export default OfferingList;
