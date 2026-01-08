import React, { useState, useEffect } from 'react';
import { Table, Button, Badge } from 'react-bootstrap';
import { api } from 'sharedFrontend';
import ApprovalModal from './ApprovalModal';

const RefundList: React.FC = () => {
    const [refunds, setRefunds] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRefund, setSelectedRefund] = useState<any | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Pagination
    const [offset, setOffset] = useState(0);
    const [total, setTotal] = useState(0);
    const limit = 20;

    // Fetch credentials logic
    const [creds, setCreds] = useState<{ pid: string, hash: string } | null>(null);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const pid = urlParams.get('pid');
        const hash = urlParams.get('hash');
        if (pid && hash) {
            setCreds({ pid, hash });
        }
    }, []);

    const fetchRefunds = async (reset: boolean = false) => {
        if (!creds) return;
        setLoading(true);
        setError(null);
        try {
            const currentOffset = reset ? 0 : offset;
            const data = await api.get(`/api/refunds/list?limit=${limit}&offset=${currentOffset}`, creds.pid, creds.hash);

            // Handle both old array format (for backward compat if API deploys slowly) and new object format
            let newItems = [];
            let totalCount = 0;

            if (Array.isArray(data)) {
                newItems = data;
                totalCount = data.length; // Approximate/Wrong if array, but fallback
            } else {
                newItems = data.items;
                totalCount = data.total;
            }

            if (reset) {
                setRefunds(newItems);
                setOffset(newItems.length);
            } else {
                setRefunds(prev => [...prev, ...newItems]);
                setOffset(prev => prev + newItems.length);
            }
            setTotal(totalCount);

        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to load refunds.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Initial load
        if (creds) {
            fetchRefunds(true);
        }
    }, [creds]);

    const handleLoadMore = () => {
        fetchRefunds(false);
    };

    const handleAction = (refund: any) => {
        setSelectedRefund(refund);
        setShowModal(true);
    };

    const handleClose = () => {
        setShowModal(false);
        setSelectedRefund(null);
    };

    const handleComplete = () => {
        // Refresh list from scratch
        fetchRefunds(true);
        handleClose();
    };

    if (loading && !creds) return <div className="text-white text-center mt-5">Loading Credentials...</div>;
    // if loading && creds... handled by standard loading or initial empty data

    // Helper to format date
    const formatDate = (iso: string) => {
        if (!iso) return '-';
        return new Date(iso).toLocaleString();
    };

    return (
        <>
            {error && (
                <div className="alert alert-danger" role="alert">
                    <h4 className="alert-heading">Error Loading Refunds</h4>
                    <p>{error}</p>
                    <hr />
                    <div className="d-flex justify-content-end">
                        <Button variant="outline-danger" size="sm" onClick={() => fetchRefunds(true)}>Retry</Button>
                    </div>
                </div>
            )}

            <Table striped bordered hover variant="dark">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Event</th>
                        <th>SubEvent</th>
                        <th>Student</th>
                        <th>Requested By</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {/* Only show rows if no error, or show what we have? usually error clears data */}
                    {!error && refunds.map((r, idx) => (
                        <tr key={idx}>
                            <td>{formatDate(r.createdAt)}</td>
                            <td>{r.eventName || r.eventCode}</td>
                            <td>{
                                ['event', 'retreat'].includes(r.subEvent?.toLowerCase())
                                    ? ''
                                    : r.subEvent
                            }</td>
                            <td>{r.studentName || r.pid}</td>
                            <td>{r.requesterName || r.requesterPid || r.requestPid || '-'}</td>
                            <td>
                                {r.refundAmount
                                    ? `$${(r.refundAmount / 100).toFixed(2)}`
                                    : (r.isInstallment ? 'Installment Offering' : 'Full Offering')
                                }
                            </td>
                            <td>
                                <Badge bg={
                                    r.approvalState === 'COMPLETE' ? 'success' :
                                        r.approvalState === 'DENIED' ? 'danger' :
                                            r.approvalState === 'ERROR' ? 'warning' : 'secondary'
                                }
                                    style={{
                                        cursor: r.approvalState !== 'PENDING' ? 'pointer' : 'default'
                                    }}
                                    onClick={() => {
                                        if (r.approvalState !== 'PENDING') {
                                            handleAction(r);
                                        }
                                    }}>
                                    {r.approvalState === 'COMPLETE' ? 'Complete' :
                                        r.approvalState === 'DENIED' ? 'Denied' :
                                            r.approvalState === 'ERROR' ? 'Error' : r.approvalState || 'Unknown'}
                                </Badge>
                                {r.approvalState !== 'PENDING' && r.approverName && (
                                    <div className="small text-white mt-1">
                                        by {r.approverName}
                                    </div>
                                )}
                            </td>
                            <td>
                                {r.approvalState === 'PENDING' && (
                                    <Button size="sm" variant="primary" onClick={() => handleAction(r)}>Approve/Deny</Button>
                                )}
                            </td>
                        </tr>
                    ))}
                    {!error && refunds.length === 0 && !loading && (
                        <tr><td colSpan={6} className="text-center">No refund requests found.</td></tr>
                    )}
                    {loading && (
                        <tr><td colSpan={6} className="text-center">Loading...</td></tr>
                    )}
                </tbody>
            </Table>

            {/* Load More Button */}
            {!error && refunds.length < total && (
                <div className="text-center mb-4">
                    <Button variant="outline-light" onClick={handleLoadMore} disabled={loading}>
                        {loading ? 'Loading...' : `Load More (${total - refunds.length} remaining)`}
                    </Button>
                </div>
            )}

            {creds && (
                <ApprovalModal
                    show={showModal}
                    onHide={handleClose}
                    refund={selectedRefund}
                    creds={creds}
                    onComplete={handleComplete}
                />
            )}
        </>
    );
};

export default RefundList;
