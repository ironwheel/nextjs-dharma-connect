// packages/sharedFrontend/src/layout.ts
import React, { useState } from "react";
import Navbar from "react-bootstrap/Navbar";
import Dropdown from "react-bootstrap/Dropdown";
import DropdownButton from "react-bootstrap/DropdownButton";
import Form from "react-bootstrap/Form";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe } from "@fortawesome/free-solid-svg-icons";

export const ColoredLine = ({ color }: { color: string }) => (
    <hr
        style={{
            color: color,
            backgroundColor: color,
            height: 1
        }}
    />
);

export const ThickColoredLine = ({ color }: { color: string }) => (
    <hr
        style={{
            color: color,
            backgroundColor: color,
            height: 3
        }}
    />
);

export const WrittenTranslationSelection = (props: {
    updateParent: () => void;
    icon?: boolean;
}) => {
    const [value, setValue] = useState(0);

    const handleSelectWrittenTranslationLanguage = (e: string | null) => {
        // This will be handled by the parent component
        if (e) {
            setValue(value + 1);
            props.updateParent();
        }
    };

    const ConditionalIcon = () => {
        if (props.icon) {
            return <><FontAwesomeIcon style={{ color: "#FFF" }} icon={faGlobe} /> {" "} </>;
        } else {
            return null;
        }
    };

    // This will be replaced with actual prompt lookup
    let buttonTitle = "Select Language";

    return (
        <>
            <div className="navbarflex" >
                <ConditionalIcon />
                < DropdownButton className="ml-auto" id="dropdown-basic-button" onSelect={handleSelectWrittenTranslationLanguage} title={buttonTitle} >
                    <Dropdown.Item eventKey="German" > Deutsch </Dropdown.Item>
                    < Dropdown.Item eventKey="Czech" > čeština </Dropdown.Item>
                    < Dropdown.Item eventKey="English" > English </Dropdown.Item>
                    < Dropdown.Item eventKey="Spanish" > Español </Dropdown.Item>
                    < Dropdown.Item eventKey="French" > Français </Dropdown.Item>
                    < Dropdown.Item eventKey="Italian" > Italiano </Dropdown.Item>
                    < Dropdown.Item eventKey="Dutch" > Nederlands </Dropdown.Item>
                    < Dropdown.Item eventKey="Portuguese" > Português </Dropdown.Item>
                    < Dropdown.Item eventKey="Russian" > русский </Dropdown.Item>
                </DropdownButton>
            </div>
        </>
    );
};

export const TopNavBar = (props: { updateParent: () => void }) => {
    return (
        <>
            <Navbar bg="primary" className="bg-primary justify-content-between" >
                <div className="eventTitle" >
                    <b>Dashboard </b>
                </div>
                < div className="eventTitle" >
                    <WrittenTranslationSelection icon={true} updateParent={props.updateParent} />
                </div>
            </Navbar>
        </>
    );
};

export const BottomNavBar = (props: { scrollMsg?: string }) => {
    let fontSize = 0;

    const ConditionalMsg = () => {
        if (typeof props.scrollMsg !== 'undefined' && props.scrollMsg.length !== 0) {
            fontSize = 14;
            return <div style={{ color: 'red' }} > <b>{props.scrollMsg} </b></div >;
        } else {
            fontSize = 10;
            return (
                <>
                    <div> <i>Questions ? <a href="mailto:connect@sakyonglineage.org" > connect@sakyonglineage.org</a></i > </div>
                    < br > </br>
                </>
            );
        }
    };

    return (
        <>
            <Navbar className="nbshorter" style={{ fontSize: fontSize, width: "100%" }} bg="light" fixed="bottom" variant="light" expand="lg" >
                <ConditionalMsg />
            </Navbar>
        </>
    );
}; 