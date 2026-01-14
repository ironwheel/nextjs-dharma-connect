
import React, { useState, useEffect, useRef } from 'react';

export interface Event {
    aid: string;
    name: string;
    subEvents?: Record<string, any>;
    list?: boolean;
    config?: any;
    hide?: boolean;
    [key: string]: any;
}

export interface SubEventItem {
    event: Event;
    subEventKey: string;
    subEventData: any;
    date: string;
    displayText: string;
    eventKey: string;
}

interface EventSelectionProps {
    events: Event[];
    selectedEventKey: string;
    selectedEventAid: string;
    onSelect: (eventKey: string) => void;
}

// Helper functions (Moved from index.tsx)
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

export const EventSelection: React.FC<EventSelectionProps> = ({
    events,
    selectedEventKey,
    selectedEventAid,
    onSelect
}) => {
    const [eventListSearchTerm, setEventListSearchTerm] = useState('');
    const [eventDropdownOpen, setEventDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Handle Click Outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setEventDropdownOpen(false);
            }
        };

        if (eventDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [eventDropdownOpen]);

    const handleEventSelection = (eventKey: string) => {
        onSelect(eventKey);
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
                style={{
                    minWidth: '350px',
                    // maxWidth: '800px', // FIX: Removed hard limit to allow growing
                    // width: 'auto', 
                    width: '100%', // Allow full width of container
                    maxWidth: '100%',
                    justifyContent: 'space-between'
                }}
            >
                <span className="dropdown-title" style={{
                    whiteSpace: 'normal', // FIX: Allow wrapping for long names
                    // overflow: 'hidden', // FIX: Remove clipping
                    // textOverflow: 'ellipsis' 
                }}>
                    {currentText}
                </span>
                <svg
                    className={`dropdown-arrow ${eventDropdownOpen ? 'rotated' : ''}`}
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                >
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
            </div>

            <div className={`dropdown-menu custom-dropdown-menu ${eventDropdownOpen ? 'open' : ''}`} style={{ width: '100%', maxWidth: 'none' }}>
                <div className="p-2 sticky-top bg-black border-bottom border-secondary">
                    <div className="search-container">
                        <input
                            type="text"
                            className="search-input w-100"
                            placeholder="Search events..."
                            value={eventListSearchTerm}
                            onChange={(e) => setEventListSearchTerm(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus // Focus search when opened (though might conflict with persistence, user issue was typing focus loss)
                        />
                    </div>
                </div>

                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {filteredItems.map(item => (
                        <button
                            key={item.eventKey}
                            className="dropdown-item"
                            onClick={() => handleEventSelection(item.eventKey)}
                            style={{
                                whiteSpace: 'normal', // FIX: Allow wrapping in options
                                textAlign: 'left'
                            }}
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
