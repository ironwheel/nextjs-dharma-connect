import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Navbar, Badge, Spinner } from 'react-bootstrap';
import { useRouter } from 'next/router';
import Head from 'next/head';
import StudentSearch from '../components/StudentSearch';
import OfferingList from '../components/OfferingList';
import { VersionBadge, getTableItem, api } from 'sharedFrontend';

export default function Home() {
    const router = useRouter();
    const { pid, hash } = router.query;
    const [selectedStudent, setSelectedStudent] = useState<any>(null);
    const [authorized, setAuthorized] = useState(false);
    const [currentUserName, setCurrentUserName] = useState<string>('Unknown');

    const [refund24hTotalCents, setRefund24hTotalCents] = useState<number | null>(null);
    const [refund24hLoading, setRefund24hLoading] = useState(false);

    // Keep in sync with `packages/api/lib/refunds.ts` guard rails.
    const REFUND_24H_LIMIT_CENTS = 1000 * 100;

    useEffect(() => {
        if (!router.isReady) return;

        if (!pid || !hash) {
            router.push('/login');
            return;
        }
        setAuthorized(true);

        // Fetch user name
        getTableItem('students', pid as string, pid as string, hash as string)
            .then((student: any) => {
                if (student) {
                    setCurrentUserName(`${student.first} ${student.last}`);
                }
            })
            .catch(err => console.error('Error fetching user info', err));

    }, [router.isReady, pid, hash, router]);

    useEffect(() => {
        if (!authorized) return;
        if (!pid || !hash) return;

        let cancelled = false;
        let intervalId: any;

        const fetchRefund24hTotals = async () => {
            setRefund24hLoading(true);
            try {
                const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
                const recent: any[] = [];

                const pageLimit = 200;
                let offset = 0;
                let done = false;

                while (!done) {
                    const data = await api.get(`/api/refunds/list?limit=${pageLimit}&offset=${offset}`, pid as string, hash as string);
                    const items = Array.isArray(data) ? data : (data.items || []);
                    if (!Array.isArray(items) || items.length === 0) break;

                    for (const r of items) {
                        const createdAt = r?.createdAt;
                        const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
                        if (!Number.isFinite(createdMs) || createdMs < oneDayAgoMs) {
                            done = true;
                            break;
                        }
                        recent.push(r);
                    }

                    offset += items.length;
                    if (items.length < pageLimit) break;
                }

                let totalCents = 0;
                for (const r of recent) {
                    if (typeof r?.refundAmount === 'number' && Number.isFinite(r.refundAmount)) {
                        totalCents += r.refundAmount;
                        continue;
                    }

                    const intentId = r?.stripePaymentIntent;
                    if (typeof intentId !== 'string' || !intentId.trim()) continue;

                    try {
                        const pi = await api.get(`/api/stripe/retrieve?id=${encodeURIComponent(intentId)}`, pid as string, hash as string);
                        const amt = pi?.amount;
                        if (typeof amt === 'number' && Number.isFinite(amt)) totalCents += amt;
                    } catch {
                        // Best-effort: ignore legacy row if Stripe lookup fails
                    }
                }

                if (!cancelled) setRefund24hTotalCents(totalCents);
            } catch (err) {
                console.error('Error fetching 24h refund totals', err);
                if (!cancelled) setRefund24hTotalCents(null);
            } finally {
                if (!cancelled) setRefund24hLoading(false);
            }
        };

        fetchRefund24hTotals();
        intervalId = setInterval(fetchRefund24hTotals, 60 * 1000);
        return () => {
            cancelled = true;
            if (intervalId) clearInterval(intervalId);
        };
    }, [authorized, pid, hash]);

    if (!authorized) return null; // Or loading spinner

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#212529', color: 'white' }}>
            <Head>
                <title>Refund Request</title>
                <link rel="icon" href="/recycle.png" />
            </Head>
            <Navbar bg="dark" variant="dark" className="mb-4 border-bottom border-secondary">
                <Container>
                    <div className="d-flex align-items-center">
                        {currentUserName && (
                            <span className="status-item user-info" style={{ marginLeft: 0, marginRight: '10px' }}>
                                {currentUserName}
                            </span>
                        )}
                        {pid && hash && (
                            <span className="status-item version-info" style={{ marginLeft: 0, marginRight: '10px' }}>
                                <VersionBadge pid={pid as string} hash={hash as string} />
                            </span>
                        )}
                        <Navbar.Brand className="me-3">Refund Requests</Navbar.Brand>
                        <div className="d-flex align-items-center" style={{ gap: '8px' }}>
                            <span className="text-light small" style={{ opacity: 0.85 }}>Last 24h</span>
                            {refund24hLoading ? (
                                <Spinner animation="border" size="sm" />
                            ) : (
                                <Badge bg={refund24hTotalCents != null && refund24hTotalCents > REFUND_24H_LIMIT_CENTS ? 'danger' : 'secondary'}>
                                    ${((refund24hTotalCents || 0) / 100).toFixed(2)} / ${(REFUND_24H_LIMIT_CENTS / 100).toFixed(2)}
                                </Badge>
                            )}
                            <span className="text-light small" style={{ opacity: 0.85 }}>Daily Limit</span>
                        </div>
                    </div>
                </Container>
            </Navbar>
            <Container className="p-4">
                <Row>
                    <Col md={4}>
                        <Card className="mb-4 bg-dark text-white border-secondary">
                            <Card.Header className="border-secondary">Student Search</Card.Header>
                            <Card.Body>
                                <StudentSearch onSelect={setSelectedStudent} />
                            </Card.Body>
                        </Card>
                    </Col>
                    <Col md={8}>
                        {selectedStudent ? (
                            <div className="text-white">
                                <OfferingList student={selectedStudent} />
                            </div>
                        ) : (
                            <div className="text-center text-muted p-5 bg-dark border border-secondary rounded">
                                Select a student to view offering history.
                            </div>
                        )}
                    </Col>
                </Row>
            </Container>
        </div>
    );
}
