
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from 'next/router';
import { Container, Row, Col, Form, Button, Spinner, ProgressBar } from "react-bootstrap";
import { ToastContainer, toast } from 'react-toastify';
import { isMobile } from 'react-device-detect';
import 'react-toastify/dist/ReactToastify.css';

// Import sharedFrontend utilities
import {
    getAllTableItems,
    authGetViews,
    authGetConfigValue,
    authGetViewsProfiles,
    getTableCount
} from 'sharedFrontend';
import { VersionBadge } from 'sharedFrontend';

// Import custom DataTable component
import { DataTable, Column } from '../components/DataTable';
import { CustomDropdown } from '../components/CustomDropdown';
import { ConfirmLoadModal } from '../components/ConfirmLoadModal';
import { EventSelection } from '../components/EventSelection';
// Types
interface Transaction {
    transaction: string;
    aid: string;
    cart: string;
    currency: string;
    email: string;
    emailReceipt: string;
    id: string;
    kmFee: number;
    name: string;
    payer: string;
    payerData: {
        amount: number;
        fee: number;
        net: number;
        [key: string]: any;
    };
    refundedAt?: string;
    status: string;
    summary: string;
    timestamp: string;
    total: number;
    [key: string]: any;
}


interface Event {
    aid: string;
    name: string;
    subEvents?: Record<string, any>;
    list?: boolean;
    config?: any;
    hide?: boolean;
    [key: string]: any;
}

interface SubEventItem {
    event: Event;
    subEventKey: string;
    subEventData: any;
    date: string;
    displayText: string;
    eventKey: string;
}


interface View {
    name: string;
    columnDefs: Array<{
        name: string;
        headerName: string;
        boolName?: string;
        stringName?: string;
        numberName?: string;
        aid?: string;
    }>;
    conditions: Array<{
        name: string;
        boolName?: string;
        boolValue?: boolean;
        dateValue?: string;
        dataValue?: string;
        statusValue?: string;
    }>;
}

const Home = () => {
    const router = useRouter();
    // State
    const [pid, setPid] = useState<string | null>(null);
    const [hash, setHash] = useState<string | null>(null);
    const [events, setEvents] = useState<Event[]>([]);

    // Selection State
    const [selectedEventKey, setSelectedEventKey] = useState<string>('all');
    const [selectedEventAid, setSelectedEventAid] = useState<string>('all');

    const [views, setViews] = useState<View[]>([]);
    const [selectedViewName, setSelectedViewName] = useState<string | null>(null);

    // Data State
    const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [cacheItems, setCacheItems] = useState<any[]>([]);
    const [rawLoaded, setRawLoaded] = useState(false);
    const [dataSource, setDataSource] = useState<'cache' | 'raw'>('cache');

    const [loadingTransactions, setLoadingTransactions] = useState(false);

    // Filter State




    // Config state
    const [offeringViewsProfile, setOfferingViewsProfile] = useState<string | null>(null);

    // Date Filter State
    const [selectedYear, setSelectedYear] = useState<string>('all');
    const [selectedMonth, setSelectedMonth] = useState<string>('all');

    // Loading State
    const [txnTotalCount, setTxnTotalCount] = useState<number>(0);
    const [txnLoadedCount, setTxnLoadedCount] = useState<number>(0);

    const years = ['all', ...Array.from({ length: new Date().getFullYear() - 2022 + 1 }, (_, i) => (new Date().getFullYear() - i).toString())];
    const months = [
        { value: 'all', label: 'All Months' },
        { value: '0', label: 'January' }, { value: '1', label: 'February' }, { value: '2', label: 'March' },
        { value: '3', label: 'April' }, { value: '4', label: 'May' }, { value: '5', label: 'June' },
        { value: '6', label: 'July' }, { value: '7', label: 'August' }, { value: '8', label: 'September' },
        { value: '9', label: 'October' }, { value: '10', label: 'November' }, { value: '11', label: 'December' }
    ];

    // Set pid and hash from router query
    useEffect(() => {
        if (router.query.pid && router.query.hash) {
            setPid(router.query.pid as string);
            setHash(router.query.hash as string);
        }
    }, [router.query]);

    // -------------------------------------------------------------------------
    // CONFIRMATION MODAL LOGIC
    // -------------------------------------------------------------------------
    const [showLoadModal, setShowLoadModal] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    const triggerLoadAction = (action: () => void) => {
        if (rawLoaded) {
            // Already loaded, just do it
            action();
        } else {
            // Prompt user
            setPendingAction(() => action);
            setShowLoadModal(true);
        }
    };

    const confirmLoadAction = () => {
        if (pendingAction) {
            // Trigger the loading action.
            // We DO NOT close the modal here. The modal becomes the progress indicator.
            pendingAction();
            // pendAction -> setDataSource('raw') -> useEffect -> fetchRawTransactions -> loadingTransactions=true
        }
        // Don't clear pendingAction yet, wait for finish
    };

    const cancelLoadAction = () => {
        if (loadingTransactions) return; // Prevent cancelling mid-load if critical? Or allow it? 
        // User asked to "leave it up until load completes".

        setShowLoadModal(false);
        setPendingAction(null);
    };

    // Close modal when loading finishes (if it was open)
    useEffect(() => {
        if (!loadingTransactions && showLoadModal && rawLoaded) {
            setShowLoadModal(false);
            setPendingAction(null);
        }
    }, [loadingTransactions, rawLoaded, showLoadModal]);

    // Modal Component
    // Components extracted to separate files


    // Initial Load - Fetch Events & Config
    useEffect(() => {
        if (!pid || !hash) return;

        const init = async () => {
            try {
                // 1. Fetch Events
                const eventsData = await getAllTableItems('events', pid as string, hash as string);
                if (eventsData && !('redirected' in eventsData) && Array.isArray(eventsData)) {
                    // Filter out list=true
                    const filteredEvents = (eventsData as Event[]).filter(e => e.list !== true);
                    // Sort events by name descending
                    const sortedEvents = filteredEvents.sort((a, b) => b.name.localeCompare(a.name));
                    setEvents(sortedEvents);
                }

                // 3. Fetch offeringViewsProfile config
                const profileConfig = await authGetConfigValue(pid as string, hash as string, 'offeringViewsProfile');
                if (profileConfig) {
                    setOfferingViewsProfile(profileConfig);
                }
            } catch (err) {
                console.error("Error initializing dashboard:", err);
                toast.error("Failed to load dashboard configuration.");
            }
        };

        init();
    }, [pid, hash]);

    // Fetch Views when profile is known
    useEffect(() => {
        if (!pid || !hash || !offeringViewsProfile) return;

        const loadViews = async () => {
            try {
                const profiles = await getAllTableItems('views-profiles', pid as string, hash as string);
                const viewsData = await getAllTableItems('views', pid as string, hash as string);

                if (Array.isArray(profiles) && Array.isArray(viewsData)) {
                    const myProfile = profiles.find(p => p.profile === offeringViewsProfile);
                    if (myProfile && myProfile.views && Array.isArray(myProfile.views)) {
                        const viewNames = myProfile.views;
                        const filteredViews = viewsData.filter(v => viewNames.includes(v.name));
                        setViews(filteredViews);

                        // Set default view if not already selected or if selected is invalid
                        if (filteredViews.length > 0) {
                            setSelectedViewName(prev => {
                                if (prev && filteredViews.find(v => v.name === prev)) return prev;

                                // Prioritize "Completed" view or any view with status='COMPLETED'
                                const completedView = filteredViews.find(v => {
                                    const s = v.conditions?.find(c => c.name === 'transactionStatus');
                                    return s?.statusValue === 'COMPLETED';
                                });

                                if (completedView) return completedView.name;

                                return filteredViews[0].name;
                            });
                        }
                    } else {
                        console.warn("Profile not found or no views:", offeringViewsProfile);
                    }
                }
            } catch (err) {
                console.error("Error loading views:", err);
            }
        };
        loadViews();
    }, [pid, hash, offeringViewsProfile]);

    // Persist selections
    useEffect(() => {
        if (selectedEventKey) {
            localStorage.setItem('offering_dashboard_event_key', selectedEventKey);
            // Backward compat/dual store
            const aid = selectedEventKey.includes(':') ? selectedEventKey.split(':').shift() || '' : selectedEventKey;
            localStorage.setItem('offering_dashboard_event', aid);
        }
    }, [selectedEventKey]);

    useEffect(() => {
        if (selectedViewName) localStorage.setItem('offering_dashboard_view', selectedViewName);
    }, [selectedViewName]);

    useEffect(() => {
        if (selectedYear) localStorage.setItem('offering_dashboard_year', selectedYear);
    }, [selectedYear]);

    useEffect(() => {
        if (selectedMonth) localStorage.setItem('offering_dashboard_month', selectedMonth);
    }, [selectedMonth]);

    // Restore persistence
    useEffect(() => {
        if (!pid || !hash) return; // Wait until ready

        // Restore Event
        const storedKey = localStorage.getItem('offering_dashboard_event_key');
        const storedAid = localStorage.getItem('offering_dashboard_event'); // Fallback

        if (storedKey) {
            setSelectedEventKey(storedKey);
            const aid = storedKey.includes(':') ? storedKey.split(':').shift() || '' : storedKey;
            setSelectedEventAid(aid);
        } else if (storedAid) {
            setSelectedEventKey(storedAid); // Might lose subevent specificity if we switched logic, but safe fallback
            setSelectedEventAid(storedAid);
        }

        const storedView = localStorage.getItem('offering_dashboard_view');
        if (storedView) setSelectedViewName(storedView);

        const storedYear = localStorage.getItem('offering_dashboard_year');
        if (storedYear) setSelectedYear(storedYear);

        const storedMonth = localStorage.getItem('offering_dashboard_month');
        if (storedMonth) setSelectedMonth(storedMonth);
    }, [pid, hash]);

    // Load Data (Cache + Config)
    useEffect(() => {
        if (!pid || !hash) return;

        const fetchData = async () => {
            try {
                setLoadingTransactions(true);

                // 1. Fetch Cache
                const cacheData = await getAllTableItems('transactions-cache', pid, hash);
                if (Array.isArray(cacheData)) {
                    setCacheItems(cacheData);
                }

                // 2. Fetch Events
                const eventsData = await getAllTableItems('events', pid, hash);
                if (!Array.isArray(eventsData) && (eventsData as any).redirected) {
                    router.push('/login');
                    return;
                }
                if (Array.isArray(eventsData)) {
                    const filteredEvents = (eventsData as Event[]).filter(e => e.list !== true);
                    setEvents(filteredEvents.sort((a, b) => b.name.localeCompare(a.name)));
                }

                // 3. Fetch View Config
                const profile = await authGetConfigValue(pid, hash, 'offeringViewsProfile');
                setOfferingViewsProfile(profile || 'default');

                const viewsData = await getAllTableItems('views', pid, hash);
                const viewsProfileData = await getAllTableItems('views-profiles', pid, hash);

                if (viewsData && viewsProfileData) {
                    const pName = profile || 'default';
                    const profileRec = (viewsProfileData as any[]).find(p => p.profile === pName);
                    if (profileRec && profileRec.views) {
                        const filteredViews = (viewsData as any[]).filter(v => profileRec.views.includes(v.name));
                        setViews(filteredViews);
                        if (filteredViews.length > 0) {
                            const defaultView = filteredViews.find(v => v.name === 'Refunded All') || filteredViews[0];
                            setSelectedViewName(defaultView.name);
                        }
                    } else {
                        setViews(viewsData as View[]);
                    }
                }

                // 4. Get Total TX Count (for progress bar later)
                const countResp = await getTableCount('transactions', pid, hash);
                if (countResp && (countResp as any).count) {
                    setTxnTotalCount((countResp as any).count);
                }

                setLoadingTransactions(false);
            } catch (err) {
                console.error("Error loading data", err);
                toast.error("Failed to load initial data");
                setLoadingTransactions(false);
            }
        };

        fetchData();
    }, [pid, hash]);

    // Helper: Fetch Raw Transactions (Lazy)
    const fetchRawTransactions = useCallback(async () => {
        if (rawLoaded || loadingTransactions || !pid || !hash) return;
        setLoadingTransactions(true);
        const onProgress = (loaded: number, chunk: number, total: number) => {
            setTxnLoadedCount(loaded);
        };
        try {
            const txs = await getAllTableItems('transactions', pid, hash, onProgress);
            if (Array.isArray(txs)) {
                setAllTransactions(txs);
                setRawLoaded(true);
            }
        } catch (e) {
            console.error(e);
            toast.error("Failed to load transactions");
        } finally {
            setLoadingTransactions(false);
        }
    }, [pid, hash, rawLoaded, loadingTransactions]);

    // Determine Display Data
    useEffect(() => {
        const isYearAll = selectedYear === 'all';
        const isMonthAll = selectedMonth === 'all';

        console.log("--- Display Data Effect ---");
        console.log(`DataSource: ${dataSource}, RawLoaded: ${rawLoaded}`);
        console.log(`Filters - Year: ${selectedYear}, Month: ${selectedMonth}, Event: ${selectedEventAid}, View: ${selectedViewName}`);

        // Debug View Object
        const debugView = views.find(v => v.name === selectedViewName);
        if (debugView) {
            console.log(`DebugViewObject: Name=${debugView.name}, Conditions=${JSON.stringify(debugView.conditions)}`);
        } else {
            console.log(`DebugViewObject: Not Found`);
        }

        console.log(`Counts - AllTxns: ${allTransactions.length}, CacheItems: ${cacheItems.length}`);


        // Auto-switch back to cache if everything is reset? 
        // Maybe too aggressive. Let's stick to explicit mode.

        if (dataSource === 'raw') {
            // ---------------------
            // SHOW RAW TRANSACTIONS
            // ---------------------
            if (!rawLoaded) {
                // If we are here, it means we entered RAW mode.
                // fetchRawTransactions checks rawLoaded internally, but we can verify.
                fetchRawTransactions();
            }

            if (!allTransactions.length) {
                setTransactions([]);
                return;
            }

            let filtered = [...allTransactions];

            // Event Filter
            if (selectedEventAid && selectedEventAid !== 'all') {
                filtered = filtered.filter((t: Transaction) => t.aid === selectedEventAid);
            }
            console.log(`After Event Filter: ${filtered.length}`);

            // Date Filter
            const y = parseInt(selectedYear);
            const m = parseInt(selectedMonth);

            if (!isYearAll) {
                if (!isMonthAll) {
                    // Specific Month
                    const startDate = new Date(y, m, 1);
                    const endDate = new Date(y, m + 1, 0, 23, 59, 59, 999);
                    filtered = filtered.filter(t => {
                        const d = new Date(t.timestamp);
                        return d >= startDate && d <= endDate;
                    });
                } else {
                    // Specific Year (All Months)
                    const startDate = new Date(y, 0, 1);
                    const endDate = new Date(y, 11, 31, 23, 59, 59, 999);
                    filtered = filtered.filter(t => {
                        const d = new Date(t.timestamp);
                        return d >= startDate && d <= endDate;
                    });
                }
            }
            console.log(`After Date Filter: ${filtered.length}`);

            // View Filter
            const currentView = views.find(v => v.name === selectedViewName);

            // STRICT FILTERING: All views on this dashboard require step === 'confirmCardPayment'
            filtered = filtered.filter(t => t.step === 'confirmCardPayment');
            console.log(`After Step Filter (confirmCardPayment): ${filtered.length}`);

            // Apply Status Filter from View
            if (currentView?.conditions) {
                const statusCond = currentView.conditions.find(c => c.name === 'transactionStatus');
                if (statusCond?.statusValue) {
                    console.log(`Applying Status Filter: ${statusCond.statusValue}`);
                    filtered = filtered.filter(t => t.status === statusCond.statusValue);
                    console.log(`After Status Filter (${statusCond.statusValue}): ${filtered.length}`);
                } else {
                    console.log("Status Condition found but no statusValue?");
                }
            } else {
                console.log("No conditions found for this view. Checking for Name-based fallback...");
                // FALLBACK: If data integrity is poor, we infer from name.
                // This is critical for local dev vs production data mismatches.
                if (currentView?.name === 'Refunded') {
                    console.log("Applying Fallback Filter: REFUNDED");
                    filtered = filtered.filter(t => t.status === 'REFUNDED');
                    console.log(`After Fallback Status Filter (REFUNDED): ${filtered.length}`);
                } else if (currentView?.name === 'Completed') {
                    console.log("Applying Fallback Filter: COMPLETED");
                    filtered = filtered.filter(t => t.status === 'COMPLETED');
                    console.log(`After Fallback Status Filter (COMPLETED): ${filtered.length}`);
                }
            }
            setTransactions(filtered);

        } else {
            // ---------------------
            // SHOW AGGREGATE CACHE
            // ---------------------
            // If year/month are selected, we just filter the cache items accordingly.
            console.log("Processing Cache Logic...");

            let filteredCache: any[] = [];
            if (isYearAll && isMonthAll) {
                // Show YEARS
                filteredCache = cacheItems.filter(i => i.type === 'YEAR');
                filteredCache.sort((a, b) => b.year - a.year);
            } else if (!isYearAll && isMonthAll) {
                // Show MONTHS for selected Year
                const yVal = parseInt(selectedYear);
                filteredCache = cacheItems.filter(i => i.type === 'MONTH' && i.year === yVal);
                filteredCache.sort((a, b) => b.month - a.month);
            } else if (!isYearAll && !isMonthAll) {
                // Specific Month (Single Row)
                const yVal = parseInt(selectedYear);
                const mVal = parseInt(selectedMonth);
                filteredCache = cacheItems.filter(i => i.type === 'MONTH' && i.year === yVal && i.month === mVal);
            } else {
                // Specific Month, All Years (unlikely UX but supported)
                const mVal = parseInt(selectedMonth);
                filteredCache = cacheItems.filter(i => i.type === 'MONTH' && i.month === mVal);
                filteredCache.sort((a, b) => b.year - a.year);
            }
            console.log(`Filtered Cache Items: ${filteredCache.length}`);

            // Map to Transaction Interface
            setTransactions(filteredCache.map(c => ({
                transaction: c.id,
                aid: 'AGGREGATE',
                cart: '',
                currency: c.currency || 'usd',
                email: '',
                emailReceipt: '',
                id: c.id,
                kmFee: c.kmFee, // In Dollars
                name: c.type === 'YEAR' ? `${c.year} Summary` : `${months.find(m => m.value === c.month.toString())?.label} ${c.year}`,
                payer: 'aggregate',
                payerData: {
                    amount: c.amount,
                    fee: c.stripeFee,
                    net: c.net
                },
                status: 'COMPLETED',
                summary: '',
                timestamp: c.updatedAt,
                total: c.amount,
                isAggregate: true,
                displayDate: c.type === 'YEAR' ? c.year.toString() : `${c.year}-${(c.month + 1).toString().padStart(2, '0')}`
            } as Transaction)));
        }
    }, [selectedYear, selectedMonth, selectedEventAid, selectedViewName, cacheItems, allTransactions, rawLoaded, views, dataSource]);




    // Helper: Calculate Totals
    const calculateTotals = () => {
        const total = { count: 0, amount: 0, stripeFee: 0, kmFee: 0, net: 0 };
        transactions.forEach(t => {
            total.count += 1;
            const amount = (t.payerData?.amount || 0);
            const fee = (t.payerData?.fee || 0);

            if (t.status === 'REFUNDED') {
                // For Refunded:
                // Amount = Amount (Positive to show magnitude, or negative?)
                // Net = -(Amount + Fee)
                // KM Fee = 0

                // User likely wants to see the Refund Amount as positive in the column, but Net as negative.
                // Let's assume aggregation follows row logic.
                total.amount += amount;
                total.stripeFee += fee;
                // KM Fee skipped
                total.net += -(amount + fee);
            } else {
                const km = ((t.kmFee || 0) * 100);
                total.amount += amount;
                total.stripeFee += fee;
                total.kmFee += km;
                total.net += (amount - (fee + km));
            }
        });
        return total;
    };

    const totals = calculateTotals();

    // Render Totals Section
    const renderTotalsSection = () => {
        const formatCurrency = (val: number) => {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val / 100);
        };

        const currentColumns = getColumns().filter(c => !c.hide);

        return (
            <div className="mb-3 p-3" style={{ backgroundColor: '#1f2937', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
                <h6 className="text-white mb-2" style={{ fontWeight: 600 }}>Totals</h6>
                <div className="table-responsive">
                    <table className="table table-dark table-sm mb-0 frozen-table" style={{ backgroundColor: 'transparent', minWidth: '1000px', width: '100%' }}>
                        <thead>
                            <tr>
                                {currentColumns.map(col => {
                                    const isNumeric = ['amount', 'fee', 'kmFee', 'net', 'Amount', 'Stripe Fee', 'KM Fee', 'Net'].includes(col.field) || (col.headerName && ['Amount', 'Stripe Fee', 'KM Fee', 'Net'].includes(col.headerName));

                                    // Logic to hide header text for Date column
                                    const headerText = (col.headerName === 'Date' || col.field === 'timestamp') ? '' : (col.headerName || col.field);

                                    return (
                                        <th
                                            key={col.field}
                                            style={{
                                                backgroundColor: 'transparent',
                                                borderBottom: '1px solid rgba(255,255,255,0.2)',
                                                color: '#9ca3af',
                                                width: col.width,
                                                textAlign: isNumeric ? 'right' : 'left'
                                            }}
                                        >
                                            {headerText}
                                        </th>
                                    )
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                {currentColumns.map(col => {
                                    let content: React.ReactNode = '';
                                    const style: React.CSSProperties = {
                                        backgroundColor: 'transparent',
                                        color: 'white',
                                        fontWeight: 'bold',
                                        width: col.width,
                                        textAlign: ['amount', 'fee', 'kmFee', 'net', 'Amount', 'Stripe Fee', 'KM Fee', 'Net'].includes(col.field) || (col.headerName && ['Amount', 'Stripe Fee', 'KM Fee', 'Net'].includes(col.headerName)) ? 'right' : 'left'
                                    };

                                    if (col.field === 'rowIndex' || col.field === '#') {
                                        content = totals.count;
                                    } else if (col.headerName === 'Date' || col.field === 'Date') {
                                        // Totals Date Logic
                                        const currentYearVal = new Date().getFullYear();
                                        const minYear = 2022; // From years array logic (current - 2022 + 1, so ends at 2022)
                                        const maxYear = currentYearVal; // Logic uses new Date().getFullYear()

                                        if (selectedYear === 'all' && selectedMonth === 'all') {
                                            content = `${minYear} to ${maxYear}`;
                                        } else if (selectedYear === 'all' && selectedMonth !== 'all') {
                                            const m = parseInt(selectedMonth) + 1; // 0-indexed to 1-indexed
                                            const mStr = m.toString().padStart(2, '0');
                                            content = `${minYear}-${mStr} to ${maxYear}-${mStr}`;
                                        } else if (selectedYear !== 'all' && selectedMonth === 'all') {
                                            content = selectedYear;
                                        } else if (selectedYear !== 'all' && selectedMonth !== 'all') {
                                            const m = parseInt(selectedMonth) + 1;
                                            const mStr = m.toString().padStart(2, '0');
                                            content = `${selectedYear}-${mStr}`;
                                        }
                                    } else if (['amount', 'Amount'].includes(col.field) || (typeof col.headerName === 'string' && col.headerName.includes('Amount'))) {
                                        content = formatCurrency(totals.amount);
                                    } else if (['fee', 'Stripe Fee'].includes(col.field) || (typeof col.headerName === 'string' && col.headerName.includes('Stripe Fee'))) {
                                        content = formatCurrency(totals.stripeFee);
                                    } else if (['kmFee', 'KM Fee'].includes(col.field) || (typeof col.headerName === 'string' && col.headerName.includes('KM Fee'))) {
                                        content = formatCurrency(totals.kmFee);
                                    } else if (['net', 'Net'].includes(col.field) || (typeof col.headerName === 'string' && col.headerName.includes('Net'))) {
                                        content = formatCurrency(totals.net);
                                    }

                                    return <td key={col.field} style={style}>{content}</td>;
                                })}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    // Format Date (YYYY-MM-DD)
    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().split('T')[0];
    };

    // Format Currency
    const formatCurrency = (val: number, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(val / 100);
    };

    const getColumns = (): Column[] => {
        const currentView = views.find(v => v.name === selectedViewName);
        if (!currentView || !currentView.columnDefs) return [];

        const cols = currentView.columnDefs.map(def => {
            const col: Column = {
                headerName: def.headerName,
                field: def.name,
            };

            if (def.name === 'rowIndex') {
                return {
                    field: 'rowIndex',
                    headerName: '#',
                    pinned: 'left' as const,
                    width: 75
                };
            }

            // Custom Render logic
            if (def.name === 'Date' || def.stringName === 'timestamp') {
                col.valueGetter = (row: Transaction) => row.timestamp;
                col.render = (row: Transaction) => {
                    if ((row as any).isAggregate) return (row as any).displayDate;
                    return formatDate(row.timestamp);
                }
                col.width = 200; // Fixed width for Date to align with Totals
            } else if (def.name === 'Refund Date' || def.name === 'Refunded Date' || def.stringName === 'refundedAt') {
                col.valueGetter = (row: Transaction) => row.refundedAt;
                col.render = (row: Transaction) => formatDate(row.refundedAt);
                col.width = 200;
            } else if (def.name === 'Amount' || def.numberName === 'amount') {
                col.valueGetter = (row: Transaction) => row.payerData?.amount || 0;
                col.render = (row: Transaction) => formatCurrency(row.payerData?.amount || 0, row.currency);
            } else if (def.name === 'Stripe Fee' || def.numberName === 'fee') {
                col.valueGetter = (row: Transaction) => row.payerData?.fee || 0;
                col.render = (row: Transaction) => formatCurrency(row.payerData?.fee || 0, row.currency);
            } else if (def.name === 'KM Fee' || def.numberName === 'kmFee') {
                col.valueGetter = (row: Transaction) => {
                    if (row.status === 'REFUNDED') return 0;
                    return (row.kmFee || 0) * 100;
                };
                col.render = (row: Transaction) => {
                    // For Refunded, user requested KM Fee not be shown
                    if (row.status === 'REFUNDED') return formatCurrency(0, row.currency);
                    return formatCurrency((row.kmFee || 0) * 100, row.currency);
                };
            } else if (def.name === 'Net') {
                col.valueGetter = (row: Transaction) => {
                    const amount = row.payerData?.amount || 0;
                    const fee = row.payerData?.fee || 0;
                    if (row.status === 'REFUNDED') return -(amount + fee);

                    const km = (row.kmFee || 0) * 100;
                    return amount - (fee + km);
                };
                col.render = (row: Transaction) => {
                    const amount = row.payerData?.amount || 0;
                    const fee = row.payerData?.fee || 0;

                    if (row.status === 'REFUNDED') {
                        // Net = -(Amount + Fee) because Fee is sunk cost
                        return formatCurrency(-(amount + fee), row.currency);
                    }

                    const km = (row.kmFee || 0) * 100;
                    return formatCurrency(amount - (fee + km), row.currency);
                };
            }

            return col;
        });

        return cols;
    };

    const columns = getColumns();


    return (
        <Container fluid className="p-0">
            <ConfirmLoadModal
                show={showLoadModal}
                loading={loadingTransactions}
                loadedCount={txnLoadedCount}
                totalCount={txnTotalCount}
                onCancel={cancelLoadAction}
                onConfirm={confirmLoadAction}
            />
            <ToastContainer />
            {/* Header: Dropdowns & Actions */}
            <nav className="modern-navbar" style={{ backgroundColor: '#1f2937', padding: '1rem' }}>
                <div className="d-flex align-items-center justify-content-between w-100 flex-wrap gap-2">
                    <div className="d-flex align-items-center gap-2">
                        <div className="event-selector">
                            <EventSelection
                                events={events}
                                selectedEventKey={selectedEventKey}
                                selectedEventAid={selectedEventAid}
                                onSelect={(eventKey) => {
                                    const selectEvent = () => {
                                        setSelectedEventKey(eventKey);
                                        // Derive Aid
                                        const aid = eventKey.includes(':') ? eventKey.split(':').shift() || '' : eventKey;
                                        setSelectedEventAid(aid);
                                    };

                                    if (eventKey === 'all') {
                                        selectEvent();
                                    } else {
                                        const action = () => {
                                            selectEvent();
                                            setDataSource('raw');
                                        };
                                        triggerLoadAction(action);
                                    }
                                }}
                            />
                        </div>

                        {/* Year Dropdown */}
                        {/* Year Dropdown */}
                        <CustomDropdown
                            value={selectedYear}
                            options={[
                                { value: 'all', label: 'All Years' },
                                ...years.filter(y => y !== 'all').map(y => ({ value: y, label: y }))
                            ]}
                            onChange={(val) => setSelectedYear(val)}
                            width="140px"
                        />

                        {/* Month Dropdown */}
                        <CustomDropdown
                            value={selectedMonth}
                            options={months.filter(m => {
                                if (selectedYear === 'all') return true;
                                if (m.value === 'all') return true;
                                const currentYear = new Date().getFullYear();
                                const selYear = parseInt(selectedYear);
                                if (selYear < currentYear) return true;
                                if (selYear === currentYear) {
                                    return parseInt(m.value) <= new Date().getMonth();
                                }
                                return false; // Future years technically not in list but good for safety
                            }).map(m => ({ value: m.value, label: m.label }))}
                            onChange={(val) => setSelectedMonth(val)}
                            width="160px"
                        />

                        {/* View Dropdown */}
                        {views.length > 0 && (
                            <CustomDropdown
                                placeholder="Select View"
                                options={views.map(v => ({ value: v.name, label: v.name }))} // View names as labels
                                value={selectedViewName || ''}
                                onChange={(key) => {
                                    if (key === selectedViewName) return;

                                    const nextView = views.find(v => v.name === key);
                                    if (!nextView) return;

                                    // Determine if this view is supported by Cache
                                    const statusCond = nextView.conditions?.find(c => c.name === 'transactionStatus');
                                    // Cache supports Status=COMPLETED (or view name 'Completed')
                                    const isCacheSafe = nextView.name === 'Completed' || statusCond?.statusValue === 'COMPLETED';

                                    if (isCacheSafe) {
                                        // Safe switch
                                        setSelectedViewName(key);
                                        // Attempt to restore cache mode if safe
                                        const isYearAll = selectedYear === 'all';
                                        const isMonthAll = selectedMonth === 'all';
                                        const isEventAll = selectedEventAid === 'all';
                                        if (isYearAll && isMonthAll && isEventAll) {
                                            setDataSource('cache');
                                        }
                                    } else {
                                        // Requires Raw Data
                                        // Trigger Modal
                                        const action = () => {
                                            setSelectedViewName(key);
                                            setDataSource('raw');
                                        };
                                        triggerLoadAction(action);
                                    }
                                }}
                                width="180px"
                            />
                        )}
                    </div>

                    <div className="d-flex align-items-center gap-2">
                        {/* Version Badge - Moved to far right */}
                        <span className="status-item version-info" style={{ marginLeft: 0, marginRight: '10px' }}>
                            <VersionBadge pid={pid as string} hash={hash as string} />
                        </span>
                    </div>
                </div>
            </nav>

            {/* Totals Section */}
            {!loadingTransactions && renderTotalsSection()}

            {/* Main Content */}
            <Container fluid className="px-3">
                <Row>
                    <Col>
                        {loadingTransactions ? (
                            <div className="text-center p-5">
                                <div className="mb-3">
                                    <Spinner animation="border" role="status" style={{ color: 'rgba(57, 193, 108, 0.8)', width: '3rem', height: '3rem' }}>
                                        <span className="visually-hidden">Loading...</span>
                                    </Spinner>
                                </div>
                                <h5 className="mb-2" style={{ color: 'white', fontWeight: 'bold' }}>
                                    {dataSource === 'raw' ? 'Loading Transactions...' : 'Loading Dashboard...'}
                                </h5>
                                {dataSource === 'raw' && (
                                    <div style={{ height: '20px' }}></div> // Spacer
                                )}
                            </div>
                        ) : (
                            <DataTable
                                data={transactions}
                                columns={columns}
                                pid={pid as string}
                                hash={hash as string}
                                canViewStudentHistory={false}
                                onRowClick={(row) => {
                                    const item = row as any;
                                    if (item.isAggregate) {
                                        if (item.displayDate && item.displayDate.length === 4) {
                                            // Year Clicked -> Filter by Year (Stay in Cache)
                                            setSelectedYear(item.displayDate);
                                            setSelectedMonth('all');
                                        } else if (item.displayDate && item.displayDate.length === 7) {
                                            // Month Clicked -> Trigger Raw Load
                                            const [y, mStr] = item.displayDate.split('-');
                                            const m = parseInt(mStr) - 1; // 0-indexed

                                            const action = () => {
                                                setSelectedYear(y);
                                                setSelectedMonth(m.toString());
                                                setDataSource('raw');
                                            };
                                            triggerLoadAction(action);
                                        }
                                    }
                                }}
                            />
                        )}
                    </Col>
                </Row>
            </Container>
        </Container >
    );
};

export default Home;