/**
 * @file packages/shared/src/SharedLayout.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Provides shared layout components like NavBars and language selection dropdowns
 * for use across different pages.
 */
import React from "react";
import { Navbar, DropdownButton, Dropdown, Form, Container } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe } from "@fortawesome/pro-solid-svg-icons";

/**
 * A dropdown component for selecting the written translation language.
 * @function WrittenTranslationSelection
 * @param {object} props - The component's props.
 * @param {string} props.currentLanguage - The currently selected language.
 * @param {function(string): void} props.onLanguageChange - Callback function invoked when a new language is selected.
 * @param {function(string): string} props.getPromptText - A function that takes a prompt key and returns the localized text.
 * @param {boolean} [props.icon=false] - If true, displays a globe icon.
 * @returns {React.Component} The rendered language selection dropdown component.
 */
export const WrittenTranslationSelection = ({ currentLanguage, onLanguageChange, getPromptText, icon = false }) => {
    /**
     * Renders a globe icon conditionally.
     * @returns {React.Component | null}
     */
    const ConditionalIcon = () => {
        if (icon) {
            // Added margin-right (mr-1 or me-1 in Bootstrap 5) or use inline style
            return <><FontAwesomeIcon style={{ color: "#FFF", marginRight: '0.3rem' }} icon={faGlobe} />{" "}</>;
        }
        return null;
    };

    let buttonTitle = getPromptText("selectLanguage");
    if (currentLanguage && currentLanguage !== "English" && currentLanguage !== "(none)") {
        buttonTitle = currentLanguage;
    }

    return (
        <div className="navbarflex d-flex align-items-center"> {/* Added d-flex for alignment */}
            <ConditionalIcon />
            <DropdownButton
                className="ml-auto" // ml-auto might not work as expected with d-flex, consider removing if layout breaks
                id="dropdown-language-select"
                onSelect={onLanguageChange}
                title={buttonTitle}
                variant="outline-light"
                size="sm"
            >
                <Dropdown.Item eventKey="German">Deutsch</Dropdown.Item>
                <Dropdown.Item eventKey="Czech">čeština</Dropdown.Item>
                <Dropdown.Item eventKey="English">English</Dropdown.Item>
                <Dropdown.Item eventKey="Spanish">Español</Dropdown.Item>
                <Dropdown.Item eventKey="French">Français</Dropdown.Item>
                <Dropdown.Item eventKey="Italian">Italiano</Dropdown.Item>
                <Dropdown.Item eventKey="Dutch">Nederlands</Dropdown.Item>
                <Dropdown.Item eventKey="Portuguese">Português</Dropdown.Item>
                <Dropdown.Item eventKey="Russian">русский</Dropdown.Item>
            </DropdownButton>
        </div>
    );
};

/**
 * Top navigation bar component for the application.
 * @function TopNavBar
 * @param {object} props - The component's props.
 * @param {string} props.titlePromptKey - The key for fetching the title prompt text.
 * @param {string} props.currentLanguage - The current application language.
 * @param {function(string): void} props.onLanguageChange - Callback for when the language is changed.
 * @param {function(string): string} props.getPromptText - Function to retrieve localized prompt text.
 * @returns {React.Component} The rendered top navigation bar.
 */
export const TopNavBar = ({ titlePromptKey, currentLanguage, onLanguageChange, getPromptText }) => {
    return (
        <Navbar bg="primary" variant="dark" className="bg-primary justify-content-between px-3">
            <Navbar.Brand href="#home" className="eventTitle">
                <b>{getPromptText(titlePromptKey)}</b>
            </Navbar.Brand>
            <div className="eventTitle">
                <WrittenTranslationSelection
                    icon={true}
                    currentLanguage={currentLanguage}
                    onLanguageChange={onLanguageChange}
                    getPromptText={getPromptText}
                />
            </div>
        </Navbar>
    );
};

/**
 * Bottom navigation bar component.
 * @function BottomNavBar
 * @param {object} props - The component's props.
 * @param {string} [props.scrollMsg] - An optional message to display.
 * @param {function(string): string} props.getPromptText - Function to retrieve localized prompt text.
 * @returns {React.Component} The rendered bottom navigation bar.
 */
export const BottomNavBar = ({ scrollMsg, getPromptText }) => {
    const hasScrollMsg = scrollMsg && scrollMsg.length !== 0;
    const fontSize = hasScrollMsg ? 14 : 10;

    const ConditionalMsg = () => {
        if (hasScrollMsg) {
            return <span style={{ color: 'red', fontWeight: 'bold' }}>{scrollMsg}</span>;
        }
        const questionsText = getPromptText("questions");
        const contactEmail = "connect@sakyonglineage.org";
        return (
            <span style={{ fontStyle: 'italic' }}>
                {questionsText}{" "}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </span>
        );
    };

    return (
        <Navbar
            className="nbshorter"
            style={{ fontSize: `${fontSize}px`, width: "100%", padding: "0.5rem 1rem" }}
            bg="light"
            variant="light"
            fixed="bottom"
            expand="lg"
        >
            <Container fluid>
                <ConditionalMsg />
            </Container>
        </Navbar>
    );
}; 