import React, { useState, useMemo } from 'react';
import { Table, Button, Form } from 'react-bootstrap';
import { VersionBadge } from 'sharedFrontend';

export interface Column {
    field: string;
    headerName?: string;
    sortable?: boolean;
    width?: number;
    cellRenderer?: string;
    editable?: boolean;
    hide?: boolean;
    pinned?: 'left' | 'right';
    writeEnabled?: boolean; // Added for new logic
}

export interface DataTableProps {
    data: any[];
    columns: Column[];
    onCellValueChanged?: (field: string, rowIndex: number, value: any) => void;
    onCellClicked?: (field: string, rowData: any) => void;
    onCheckboxChanged?: (field: string, studentId: string, checked: boolean) => void;
    onCSVExport?: () => void;
    loading?: boolean;
    websocketStatus?: string;
    connectionId?: string;
    studentUpdateCount?: number;
    itemCount?: number;
    canWriteViews?: boolean;
    canExportCSV?: boolean;
    canViewStudentHistory?: boolean;
    currentUserName?: string;
    canRefreshCache?: boolean;
    onRefreshCache?: () => void;
    /**
     * Authentication context required for sharedFrontend API calls (e.g., VersionBadge).
     */
    pid?: string;
    hash?: string;
    recordCountLabel?: string;
}

export const DataTable: React.FC<DataTableProps> = ({
    data,
    columns,
    onCellValueChanged,
    onCellClicked,
    onCheckboxChanged,
    onCSVExport,
    loading = false,
    websocketStatus,
    connectionId,
    studentUpdateCount,
    itemCount,
    canWriteViews,
    canExportCSV,
    canViewStudentHistory,
    currentUserName,
    canRefreshCache,
    onRefreshCache,
    pid,
    hash,
    recordCountLabel
}) => {
    const [sortConfig, setSortConfig] = useState<{ field: string; direction: 'asc' | 'desc' }>({ field: 'name', direction: 'asc' });
    const [editingCell, setEditingCell] = useState<{ rowIndex: number; field: string } | null>(null);
    const [editValue, setEditValue] = useState('');

    // Filter out hidden columns
    const visibleColumns = useMemo(() => {
        const filtered = columns.filter(col => !col.hide);
        return filtered;
    }, [columns]);

    // Sort data
    const sortedData = useMemo(() => {
        return [...data].sort((a, b) => {
            const aValue = a[sortConfig.field];
            const bValue = b[sortConfig.field];

            if (aValue === bValue) return 0;
            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            const comparison = aValue < bValue ? -1 : 1;
            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
    }, [data, sortConfig]);

    // Handle column sorting
    const handleSort = (field: string) => {
        setSortConfig(current => {
            if (current.field === field) {
                return current.direction === 'asc'
                    ? { field, direction: 'desc' }
                    : { field, direction: 'asc' };
            }
            return { field, direction: 'asc' };
        });
    };

    // Handle cell editing
    const handleCellEdit = (rowIndex: number, field: string, value: any) => {
        const col = columns.find(c => c.field === field);
        if (!canWriteViews || !col?.writeEnabled) return;
        setEditingCell({ rowIndex, field });
        setEditValue(value?.toString() || '');
    };

    const handleCellSave = () => {
        if (editingCell && onCellValueChanged) {
            onCellValueChanged(editingCell.field, editingCell.rowIndex, editValue);
        }
        setEditingCell(null);
        setEditValue('');
    };

    const handleCellCancel = () => {
        setEditingCell(null);
        setEditValue('');
    };

    // Handle cell clicks
    const handleCellClick = (field: string, rowData: any) => {
        if (onCellClicked) {
            onCellClicked(field, rowData);
        }
    };



    // Render cell content
    const renderCell = (row: any, col: Column, rowIndex: number) => {
        const value = row[col.field];
        const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.field === col.field;

        // Index column - handle any field that represents row index
        if (col.field === '#' || col.field === 'rowIndex' || col.headerName === '#' || col.field.toLowerCase().includes('index') || col.field.toLowerCase().includes('row')) {
            return rowIndex + 1;
        }

        // Checkbox renderer
        if (col.cellRenderer === 'checkboxRenderer') {
            const isWriteEnabled = canWriteViews && col.writeEnabled;
            return (
                <Form.Check
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => {
                        if (isWriteEnabled && onCheckboxChanged) {
                            // Pass the student ID instead of row index
                            const studentId = row.id;
                            if (studentId) {
                                onCheckboxChanged(col.field, studentId, e.target.checked);
                            }
                        }
                    }}
                    disabled={!isWriteEnabled || loading}
                    style={{ cursor: isWriteEnabled ? 'pointer' : 'default' }}
                />
            );
        }

        // Editable cell
        if (isEditing && col.editable && col.writeEnabled && canWriteViews) {
            return (
                <div className="d-flex">
                    <Form.Control
                        size="sm"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCellSave();
                            if (e.key === 'Escape') handleCellCancel();
                        }}
                        autoFocus
                    />
                    <Button size="sm" variant="success" className="ms-1" onClick={handleCellSave}>
                        ✓
                    </Button>
                    <Button size="sm" variant="secondary" className="ms-1" onClick={handleCellCancel}>
                        ✕
                    </Button>
                </div>
            );
        }

        // Clickable cell for name/email/owyaa
        if (col.field === 'name' || col.field === 'email' || col.field === 'owyaa') {
            if (col.field === 'name') {
                if (canViewStudentHistory === true) {
                    return (
                        <span
                            className="text-primary cursor-pointer"
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleCellClick(col.field, row)}
                        >
                            {value}
                        </span>
                    );
                } else {
                    return (
                        <span
                            style={{ color: 'black', cursor: 'default' }}
                        >
                            {value}
                        </span>
                    );
                }
            }
            // For email/owyaa, keep existing logic
            return (
                <span
                    className="text-primary cursor-pointer"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleCellClick(col.field, row)}
                >
                    {value}
                </span>
            );
        }

        // Default cell
        return value?.toString() || '';
    };

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner-border text-light" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
                <div className="mt-3 text-light">Loading data...</div>
            </div>
        );
    }

    return (
        <div className="data-table-container">
            <div className="status-bar">
                <span className="status-item">
                    Records: {recordCountLabel || itemCount}
                </span>
                {websocketStatus && (
                    <span className={`status-item ${websocketStatus === 'open' ? 'websocket-connected' : 'websocket-disconnected'}`}>
                        {websocketStatus === 'open' ? 'Database connected' : 'Database disconnected'}
                    </span>
                )}
                {typeof studentUpdateCount !== 'undefined' && (
                    <span className="status-item">
                        Updates: {studentUpdateCount}
                    </span>
                )}
                <span className={`status-item ${canWriteViews ? 'write-enabled' : ''}`}>
                    {canWriteViews ? 'Write Enabled' : 'Read Only'}
                </span>
                {canViewStudentHistory === true && (
                    <span className="status-item student-history">
                        History Enabled
                    </span>
                )}
                {canRefreshCache && onRefreshCache && (
                    <button
                        className="status-item refresh-cache"
                        onClick={onRefreshCache}
                        title="Click to refresh eligibility cache"
                        style={{
                            backgroundColor: '#8b5cf6',
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M23 4v6h-6" />
                            <path d="M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                        Refresh Cache
                    </button>
                )}
                {canExportCSV && (
                    <button
                        className="status-item export-enabled"
                        onClick={onCSVExport}
                        title="Click to export CSV"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7,10 12,15 17,10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Export Enabled
                    </button>
                )}
                {currentUserName && (
                    <span className="status-item user-info">
                        {currentUserName}
                    </span>
                )}
                {pid && hash && (
                    <span className="status-item version-info">
                        <VersionBadge pid={pid} hash={hash} />
                    </span>
                )}
            </div>

            <div className="table-container">
                <div className="table-wrapper">
                    <Table striped bordered hover className="frozen-table ag-theme-alpine">
                        <thead>
                            <tr>
                                {visibleColumns.map((col, index) => (
                                    <th
                                        key={col.field}
                                        style={{
                                            width: col.width,
                                            cursor: col.sortable ? 'pointer' : 'default',
                                            userSelect: 'none'
                                        }}
                                        onClick={() => col.sortable && handleSort(col.field)}
                                        className={col.sortable ? 'sortable-header' : ''}
                                    >
                                        <div className="d-flex align-items-center">
                                            {col.headerName || col.field}
                                            {col.sortable && sortConfig.field === col.field && (
                                                <span className="ms-1">
                                                    {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                    {visibleColumns.map((col, colIndex) => (
                                        <td
                                            key={col.field}
                                            style={{
                                                width: col.width,
                                                cursor: col.editable ? 'pointer' : 'default'
                                            }}
                                            onDoubleClick={() => col.editable && handleCellEdit(rowIndex, col.field, row[col.field])}
                                        >
                                            {renderCell(row, col, rowIndex)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </div>
            </div>
        </div>
    );
}; 