const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** Who to write to with questions, when configured. */
export default function Contact() {
    if (!CONTACT_EMAIL) return null;
    return (
        <p className="contact">
            Questions? Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
    );
}
