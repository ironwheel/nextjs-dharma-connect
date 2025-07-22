import React, { useState, useMemo } from 'react';
import { Table, Button, Form } from 'react-bootstrap';

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
    onCheckboxChanged?: (field: string, rowIndex: number, checked: boolean) => void;
    loading?: boolean;
    websocketStatus?: string;
    connectionId?: string;
    studentUpdateCount?: number;
    itemCount?: number;
    canWriteViews?: boolean;
    canExportCSV?: boolean;
}

export const DataTable: React.FC<DataTableProps> = ({
    data,
    columns,
    onCellValueChanged,
    onCellClicked,
    onCheckboxChanged,
    loading = false,
    websocketStatus,
    connectionId,
    studentUpdateCount,
    itemCount,
    canWriteViews,
    canExportCSV
}) => {
    const [sortConfig, setSortConfig] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(null);
    const [editingCell, setEditingCell] = useState<{ rowIndex: number; field: string } | null>(null);
    const [editValue, setEditValue] = useState('');

    // Filter out hidden columns
    const visibleColumns = useMemo(() => {
        const filtered = columns.filter(col => !col.hide);
        return filtered;
    }, [columns]);

    // Sort data
    const sortedData = useMemo(() => {
        if (!sortConfig) return data;

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
            if (current?.field === field) {
                return current.direction === 'asc'
                    ? { field, direction: 'desc' }
                    : null;
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

    // Handle checkbox changes
    const handleCheckboxChange = (rowIndex: number, field: string, checked: boolean) => {
        const col = columns.find(c => c.field === field);
        if (!canWriteViews || !col?.writeEnabled) return;
        if (onCheckboxChanged) {
            onCheckboxChanged(col.field, rowIndex, checked);
        }
    };

    // Handle cell clicks
    const handleCellClick = (field: string, rowData: any) => {
        if (onCellClicked) {
            onCellClicked(field, rowData);
        }
    };

    // Export to CSV
    const exportToCSV = () => {
        const headers = visibleColumns.map(col => col.headerName || col.field);
        const csvContent = [
            headers.join(','),
            ...sortedData.map(row =>
                visibleColumns.map(col => {
                    const value = row[col.field];
                    // Escape commas and quotes in CSV
                    if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value?.toString() || '';
                }).join(',')
            )
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'admin-dashboard-export.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
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
            return (
                <Form.Check
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => {
                        if (canWriteViews && col.writeEnabled && onCheckboxChanged) {
                            onCheckboxChanged(col.field, rowIndex, e.target.checked);
                        }
                    }}
                    disabled={!canWriteViews || !col.writeEnabled || loading}
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

        // Clickable cell
        if (col.field === 'name' || col.field === 'email' || col.field === 'owyaa') {
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
            <div className="text-center p-4">
                <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="data-table-container">
            <div className="d-flex align-items-center mb-3">
                <h5 className="me-3">Total Records: {itemCount}</h5>
                {websocketStatus && (
                    <span className={`badge ${websocketStatus === 'open' ? 'bg-success' : websocketStatus === 'connecting' ? 'bg-warning' : 'bg-danger'} me-2`}>
                        WebSocket: {websocketStatus}
                    </span>
                )}
                {connectionId && websocketStatus === 'open' && (
                    <span className="badge bg-primary me-2">
                        ID: {connectionId}
                    </span>
                )}
                {typeof studentUpdateCount !== 'undefined' && (
                    <span className="badge bg-info me-2">
                        Updates: {studentUpdateCount}
                    </span>
                )}
                <span className={`badge ${canWriteViews ? 'bg-success' : 'bg-secondary'} me-2`}>
                    {canWriteViews ? 'Write Enabled' : 'Read Only'}
                </span>
            </div>

            <div className="table-container">
                <div className="table-wrapper">
                    <Table striped bordered hover className="frozen-table">
                        <thead>
                            <tr>
                                {visibleColumns.map((col, index) => (
                                    <th
                                        key={col.field}
                                        data-field={col.field}
                                        data-pinned={col.pinned}
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
                                            {col.sortable && sortConfig?.field === col.field && (
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
                                            data-field={col.field}
                                            data-pinned={col.pinned}
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