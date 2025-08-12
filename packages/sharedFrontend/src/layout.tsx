/**
 * @file packages/sharedFrontend/src/layout.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines the layout components for the application.
 */

import React, { useState, createContext, useContext, useEffect } from 'react';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { updateLanguage } from './prompts';

// Language context for managing language state across components
interface LanguageContextType {
    currentLanguage: string;
    setLanguage: (language: string) => void;
    initializeLanguage: (studentLangPref?: string) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

/**
 * @function useLanguage
 * @description A custom hook to use the Language context.
 * @returns {LanguageContextType} The Language context.
 * @throws {Error} If used outside of a LanguageProvider.
 */
export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};

/**
 * @component LanguageProvider
 * @description This component provides a Language context to its children.
 * @param {object} props - The props for the component.
 * @param {React.ReactNode} props.children - The children to render.
 * @param {string} props.initialLanguage - The initial language.
 * @returns {React.FC} The LanguageProvider component.
 */
export const LanguageProvider: React.FC<{ children: React.ReactNode; initialLanguage?: string }> = ({ children, initialLanguage = 'English' }) => {
    const [currentLanguage, setCurrentLanguage] = useState(initialLanguage);

    const setLanguage = (language: string) => {
        setCurrentLanguage(language);
        // Update the student's writtenLangPref using the prompts module
        updateLanguage(language);
    };

    const initializeLanguage = (studentLangPref?: string) => {
        if (studentLangPref) {
            setCurrentLanguage(studentLangPref);
        }
    };

    return (
        <LanguageContext.Provider value={{ currentLanguage, setLanguage, initializeLanguage }}>
            {children}
        </LanguageContext.Provider>
    );
};

/**
 * @component ColoredLine
 * @description A colored horizontal line.
 * @param {object} props - The props for the component.
 * @param {string} props.color - The color of the line.
 * @returns {React.FC} The ColoredLine component.
 */
export const ColoredLine = ({ color }: { color: string }) => (
    <hr
        style={{
            color: color,
            backgroundColor: color,
            height: 1
        }}
    />
);

/**
 * @component ThickColoredLine
 * @description A thick colored horizontal line.
 * @param {object} props - The props for the component.
 * @param {string} props.color - The color of the line.
 * @returns {React.FC} The ThickColoredLine component.
 */
export const ThickColoredLine = ({ color }: { color: string }) => (
    <hr
        style={{
            color: color,
            backgroundColor: color,
            height: 3
        }}
    />
);

/**
 * @component WrittenTranslationSelection
 * @description A component for selecting the written translation language.
 * @param {object} props - The props for the component.
 * @param {boolean} props.icon - Whether to display the icon.
 * @returns {React.FC} The WrittenTranslationSelection component.
 */
export const WrittenTranslationSelection = (props: {
    icon?: boolean;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const { currentLanguage, setLanguage } = useLanguage();

    const handleSelectWrittenTranslationLanguage = (language: string) => {
        setLanguage(language);
        setIsOpen(false);
    };

    const languages = [
        { key: "German", label: "Deutsch" },
        { key: "Czech", label: "čeština" },
        { key: "English", label: "English" },
        { key: "Spanish", label: "Español" },
        { key: "French", label: "Français" },
        { key: "Italian", label: "Italiano" },
        { key: "Dutch", label: "Nederlands" },
        { key: "Portuguese", label: "Português" },
        { key: "Russian", label: "русский" }
    ];

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-white/15 border border-white/30 rounded-lg text-white text-sm font-semibold hover:bg-white/25 hover:border-white/40 transition-all duration-200 hover:-translate-y-0.5 shadow-lg"
            >
                {props.icon && (
                    <FontAwesomeIcon icon={faGlobe} className="text-white" />
                )}
                <span>{currentLanguage}</span>
                <FontAwesomeIcon
                    icon={faChevronDown}
                    className={`text-white transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-black border border-white/20 rounded-lg shadow-xl z-50 opacity-100 transform translate-y-0 transition-all duration-200">
                    {languages.map((lang) => (
                        <button
                            key={lang.key}
                            onClick={() => handleSelectWrittenTranslationLanguage(lang.key)}
                            className="block w-full px-4 py-3 text-left text-white text-sm font-medium hover:bg-white/10 hover:font-bold transition-all duration-150 hover:translate-x-1 border-b border-white/10 last:border-b-0"
                        >
                            {lang.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * @component TopNavBar
 * @description The top navigation bar.
 * @param {object} props - The props for the component.
 * @param {string} props.title - The title to display.
 * @returns {React.FC} The TopNavBar component.
 */
export const TopNavBar = (props: { title?: string }) => {
    return (
        <div className="sticky top-0 z-50 bg-gray-900 border border-gray-700 rounded-lg p-4 mb-4 flex items-center justify-between shadow-lg max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center">
                <h1 className="text-xl font-bold text-white">{props.title || 'Dashboard'}</h1>
            </div>
            <div className="flex items-center">
                <WrittenTranslationSelection icon={true} />
            </div>
        </div>
    );
};

/**
 * @component BottomNavBar
 * @description The bottom navigation bar.
 * @param {object} props - The props for the component.
 * @param {string} props.scrollMsg - The message to display.
 * @returns {React.FC} The BottomNavBar component.
 */
export const BottomNavBar = (props: { scrollMsg?: string }) => {
    const ConditionalMsg = () => {
        if (typeof props.scrollMsg !== 'undefined' && props.scrollMsg.length !== 0) {
            return (
                <div className="text-red-400 text-sm font-bold">
                    {props.scrollMsg}
                </div>
            );
        } else {
            return (
                <div className="text-gray-400 text-xs">
                    <i>Questions? <a href="mailto:connect@sakyonglineage.org" className="text-blue-400 hover:text-blue-300">connect@sakyonglineage.org</a></i>
                </div>
            );
        }
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 p-4 z-50">
            <div className="max-w-7xl mx-auto">
                <ConditionalMsg />
            </div>
        </div>
    );
}; 