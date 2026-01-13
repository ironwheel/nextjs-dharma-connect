
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

    const [loadingTransactions, setLoadingTransactions] = useState(false);

    // Filter State
    const [eventListSearchTerm, setEventListSearchTerm] = useState('');
    const [eventDropdownOpen, setEventDropdownOpen] = useState(false);



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

    // Helper functions for Event Selector
    const formatSubEventDisplay = (event: Event, subEventKey: string, subEventData: any) => {
        const date = subEventData.date || '';
        const hasMultipleSubEvents = Object.keys(event.subEvents || {}).length > 1;

        if (date && hasMultipleSubEvents) {
            return `${date} ${event.name} (${subEventKey})`;
        } else if (date) {
            return `${date} ${event.name}`;
        } else {
            return event.name;
        }
    };

    const getAllSubEvents = (events: Event[]): SubEventItem[] => {
        const subEvents: SubEventItem[] = [];
        if (!Array.isArray(events)) return subEvents;

        events.forEach(event => {
            if (event.hide) return;
            if (event.list === true) return;

            const subEventKeys = Object.keys(event.subEvents || {});

            if (subEventKeys.length === 0) {
                subEvents.push({
                    event,
                    subEventKey: '',
                    subEventData: {},
                    date: '',
                    displayText: event.name,
                    eventKey: `${event.aid}`
                });
            } else {
                subEventKeys.forEach(subEventKey => {
                    const subEventData = (event.subEvents || {})[subEventKey];
                    const date = subEventData?.date || '';
                    const displayText = formatSubEventDisplay(event, subEventKey, subEventData);
                    subEvents.push({
                        event,
                        subEventKey,
                        subEventData,
                        date,
                        displayText,
                        eventKey: `${event.aid}:${subEventKey}`
                    });
                });
            }
        });
        return subEvents;
    };

    const sortSubEventsByDate = (subEvents: SubEventItem[]): SubEventItem[] => {
        return [...subEvents].sort((a, b) => {
            if (a.date && b.date) {
                return b.date.localeCompare(a.date); // Newest first
            } else if (a.date) {
                return -1;
            } else if (b.date) {
                return 1;
            } else {
                return a.displayText.localeCompare(b.displayText);
            }
        });
    };

    // EventSelection Component
    const EventSelection = () => {
        const handleEventSelection = (eventKey: string) => {
            setSelectedEventKey(eventKey);
            // Derive Aid
            const aid = eventKey.includes(':') ? eventKey.split(':').shift() || '' : eventKey;
            setSelectedEventAid(aid);

            setEventDropdownOpen(false);
            setEventListSearchTerm('');
        };

        const allSubEvents = getAllSubEvents(events);
        const sortedSubEvents = sortSubEventsByDate(allSubEvents);

        // Logic: Add "All Events" at top 
        const allItems = [
            { displayText: 'All Events', eventKey: 'all', event: { aid: 'all', name: 'All Events' } as Event },
            ...sortedSubEvents
        ];

        const filteredItems = eventListSearchTerm.trim() === ''
            ? allItems
            : allItems.filter(item => {
                const searchLower = eventListSearchTerm.toLowerCase();
                return item.displayText.toLowerCase().includes(searchLower) ||
                    (item.event && item.event.aid.toLowerCase().includes(searchLower));
            });

        // Find current display text
        let currentText = "Select Event";
        if (selectedEventKey === 'all') {
            currentText = "All Events";
        } else {
            const found = sortedSubEvents.find(i => i.eventKey === selectedEventKey);
            if (found) currentText = found.displayText;
            else {
                // Fallback
                const foundByAid = sortedSubEvents.find(i => i.event.aid === selectedEventAid);
                if (foundByAid) currentText = foundByAid.displayText;
            }
        }

        return (
            <div className="modern-dropdown" ref={dropdownRef}>
                <div
                    className="dropdown-trigger"
                    onClick={() => setEventDropdownOpen(!eventDropdownOpen)}
                    style={{ minWidth: '350px', maxWidth: '800px', width: 'auto', justifyContent: 'space-between' }}
                >
                    <span className="dropdown-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentText}</span>
                    <svg
                        className={`dropdown-arrow ${eventDropdownOpen ? 'rotated' : ''}`}
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                    >
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </div>

                <div className={`dropdown-menu custom-dropdown-menu ${eventDropdownOpen ? 'open' : ''}`}>
                    <div className="p-2 sticky-top bg-black border-bottom border-secondary">
                        <div className="search-container">
                            <input
                                type="text"
                                className="search-input w-100"
                                placeholder="Search events..."
                                value={eventListSearchTerm}
                                onChange={(e) => setEventListSearchTerm(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                    </div>

                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {filteredItems.map(item => (
                            <button
                                key={item.eventKey}
                                className="dropdown-item"
                                onClick={() => handleEventSelection(item.eventKey)}
                            >
                                {item.displayText}
                            </button>
                        ))}
                        {filteredItems.length === 0 && (
                            <div className="p-3 text-center text-muted">No events found</div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // Close dropdown on click outside
    const dropdownRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setEventDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

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

    // Fetch All Transactions ONCE
    useEffect(() => {
        if (!pid || !hash) return;

        const fetchAllTransactions = async () => {
            // Only fetch if empty
            if (allTransactions.length > 0) return;

            setLoadingTransactions(true);
            setTxnLoadedCount(0);
            try {
                // Get Total Count first
                const countRes = await getTableCount('transactions', pid as string, hash as string);
                const total = 'count' in countRes ? countRes.count : 0;
                setTxnTotalCount(total);

                const onProgress = (count: number, chunk: number, totalChunks: number) => {
                    setTxnLoadedCount(count);
                };

                const allTxns = await getAllTableItems('transactions', pid as string, hash as string, onProgress);

                if (Array.isArray(allTxns)) {
                    setAllTransactions(allTxns as Transaction[]);
                }
            } catch (err) {
                console.error("Error fetching transactions:", err);
                toast.error("Failed to load transactions.");
            } finally {
                setLoadingTransactions(false);
            }
        };

        fetchAllTransactions();
    }, [pid, hash]);

    // Filter Transactions locally
    useEffect(() => {
        if (!allTransactions.length) {
            setTransactions([]);
            return;
        }

        let filtered = [...allTransactions];

        // 1. Filter by Event
        if (selectedEventAid && selectedEventAid !== 'all') {
            filtered = filtered.filter((t: Transaction) => t.aid === selectedEventAid);
        }

        // 2. Filter by Date (Year/Month)
        if (selectedYear !== 'all') {
            const year = parseInt(selectedYear);
            let startDate: Date;
            let endDate: Date;

            if (selectedMonth !== 'all') {
                const month = parseInt(selectedMonth);
                startDate = new Date(year, month, 1);
                endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
            } else {
                startDate = new Date(year, 0, 1);
                endDate = new Date(year, 11, 31, 23, 59, 59, 999);
            }

            filtered = filtered.filter((t: Transaction) => {
                const d = new Date(t.timestamp);
                return d >= startDate && d <= endDate;
            });
        } else if (selectedMonth !== 'all') {
            // Year is 'all' but Month is selected -> Filter by month across ANY year
            const monthToCheck = parseInt(selectedMonth);
            filtered = filtered.filter((t: Transaction) => {
                const d = new Date(t.timestamp);
                return d.getMonth() === monthToCheck;
            });
        }

        // 3. Filter by View Conditions
        const currentView = views.find(v => v.name === selectedViewName);
        if (currentView && currentView.conditions) {
            const statusCond = currentView.conditions.find(c => c.name === 'transactionStatus');
            if (statusCond && statusCond.statusValue) {
                filtered = filtered.filter((t: Transaction) => t.status === statusCond.statusValue);
            }
        }

        setTransactions(filtered);

    }, [allTransactions, selectedEventAid, selectedYear, selectedMonth, selectedViewName, views]);



    // Helper: Calculate Totals
    const calculateTotals = () => {
        const total = { count: 0, amount: 0, stripeFee: 0, kmFee: 0, net: 0 };
        transactions.forEach(t => {
            total.count += 1;
            total.amount += (t.payerData?.amount || 0);
            total.stripeFee += (t.payerData?.fee || 0);
            total.kmFee += ((t.kmFee || 0) * 100); // kmFee is in dollars, convert to cents
        });
        total.net = total.amount - (total.stripeFee + total.kmFee);
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

    // Columns Definition
    const getColumns = (): Column[] => {
        const currentView = views.find(v => v.name === selectedViewName);
        if (!currentView || !currentView.columnDefs) return [];

        return currentView.columnDefs.map(def => {
            const col: Column = {
                headerName: def.headerName,
                field: def.name,
            };

            if (def.name === 'rowIndex') {
                return {
                    field: 'rowIndex',
                    headerName: '#',
                    pinned: 'left',
                    width: 75
                };
            }

            // Custom Render logic
            if (def.name === 'Date' || def.stringName === 'timestamp') {
                col.render = (row: Transaction) => formatDate(row.timestamp);
                col.width = 200; // Fixed width for Date to align with Totals
            } else if (def.name === 'Refund Date' || def.stringName === 'refundedAt') {
                col.render = (row: Transaction) => formatDate(row.refundedAt);
                col.width = 200;
            } else if (def.name === 'Amount' || def.numberName === 'amount') {
                col.render = (row: Transaction) => formatCurrency(row.payerData?.amount || 0, row.currency);
            } else if (def.name === 'Stripe Fee' || def.numberName === 'fee') {
                col.render = (row: Transaction) => formatCurrency(row.payerData?.fee || 0, row.currency);
            } else if (def.name === 'KM Fee' || def.numberName === 'kmFee') {
                col.render = (row: Transaction) => formatCurrency((row.kmFee || 0) * 100, row.currency);
            } else if (def.name === 'Net') {
                col.render = (row: Transaction) => {
                    const amount = row.payerData?.amount || 0;
                    const fee = row.payerData?.fee || 0;
                    const km = (row.kmFee || 0) * 100;
                    return formatCurrency(amount - (fee + km), row.currency);
                };
            }

            return col;
        });
    };

    const columns = getColumns();


    return (
        <Container fluid className="p-0">
            <ToastContainer />
            {/* Header: Dropdowns & Actions */}
            <nav className="modern-navbar" style={{ backgroundColor: '#1f2937', padding: '1rem' }}>
                <div className="d-flex align-items-center justify-content-between w-100 flex-wrap gap-2">
                    <div className="d-flex align-items-center gap-2">
                        <div className="event-selector">
                            <EventSelection />
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
                                value={selectedViewName || ''}
                                options={views.map(v => ({ value: v.name, label: v.name }))}
                                onChange={(val) => setSelectedViewName(val)}
                                placeholder="Select View"
                                width="180px"
                            />
                        )}
                    </div>

                    <div className="d-flex align-items-center gap-2">
                        {/* Version Badge - Moved to far right */}
                        <div className="d-flex align-items-center px-3 py-2" style={{
                            background: 'rgba(59, 130, 246, 0.3)',
                            border: '1px solid rgba(59, 130, 246, 0.6)',
                            borderRadius: '0.5rem',
                            color: '#60a5fa',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                            height: '40px',
                            whiteSpace: 'nowrap'
                        }}>
                            v0.1.0
                        </div>
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
                                <h5 className="mb-2" style={{ color: 'white', fontWeight: 'bold' }}>Fetching Transactions...</h5>
                                <div className="w-50 mx-auto">
                                    <ProgressBar
                                        now={(txnLoadedCount / (txnTotalCount || 1)) * 100}
                                        label={`${txnLoadedCount} / ${txnTotalCount || '...'}`}
                                        animated
                                        variant="success"
                                    />
                                </div>
                            </div>
                        ) : (
                            <DataTable
                                data={transactions}
                                columns={columns}
                                pid={pid as string}
                                hash={hash as string}
                                canViewStudentHistory={false}
                            />
                        )}
                    </Col>
                </Row>
            </Container>
        </Container >
    );
};

export default Home;