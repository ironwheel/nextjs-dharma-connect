
import React, { useState, useRef, useEffect } from 'react';

interface DropdownOption {
    value: string;
    label: string;
}

interface CustomDropdownProps {
    value: string;
    options: DropdownOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    style?: React.CSSProperties;
    width?: string;
}

export const CustomDropdown: React.FC<CustomDropdownProps> = ({
    value,
    options,
    onChange,
    placeholder = 'Select...',
    style,
    width = 'auto'
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(opt => opt.value === value);
    const displayLabel = selectedOption ? selectedOption.label : placeholder;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    return (
        <div className="modern-dropdown" ref={dropdownRef} style={{ ...style, width }}>
            <div
                className="dropdown-trigger"
                onClick={() => {
                    console.log('Dropdown clicked! Current State:', !isOpen);
                    setIsOpen(!isOpen);
                }}
                style={{ justifyContent: 'space-between', minWidth: width === 'auto' ? '120px' : width }}
            >
                <span className="dropdown-title text-truncate">{displayLabel}</span>
                <svg
                    className={`dropdown-arrow ${isOpen ? 'rotated' : ''}`}
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                >
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
            </div>

            <div className={`dropdown-menu custom-dropdown-menu ${isOpen ? 'open' : ''}`}>
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {options.map(option => (
                        <button
                            key={option.value}
                            className="dropdown-item"
                            onClick={() => {
                                onChange(option.value);
                                setIsOpen(false);
                            }}
                            style={{ fontWeight: option.value === value ? 'bold' : 'normal' }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
