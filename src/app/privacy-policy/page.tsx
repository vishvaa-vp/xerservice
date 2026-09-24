import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy | XerService',
    description: 'Privacy Policy for XerService printing, ordering, and WhatsApp document services.',
};

export default function PrivacyPolicyPage() {
    return (
        <article className="container-sm section">
            <h1 className="section-title">Privacy Policy</h1>

            <div className="public-terms">
                <p><strong>Last updated:</strong> 25 September 2026</p>

                <p>
                    This Privacy Policy explains how XerService, operated by XER SERVICE TECHNOLOGIES PRIVATE LIMITED,
                    collects, uses, stores, and protects information when you use our website, customer account,
                    printing services, WhatsApp document import, and related features.
                </p>

                <h3>1. Information We Collect</h3>
                <p>Depending on how you use XerService, we may collect:</p>
                <ul>
                    <li>Account information such as your name, email address, phone number, profile details, and account identifiers.</li>
                    <li>WhatsApp information such as your WhatsApp phone number, sender identifier, message identifier, and connection status when you link WhatsApp to XerService.</li>
                    <li>Documents and media that you intentionally send or upload for printing, including PDFs and supported image files.</li>
                    <li>Order information such as selected print shop, print settings, quantities, pricing, payment status, pickup or delivery details, and order history.</li>
                    <li>Technical and usage information such as device, browser, IP address, request logs, error logs, and security events needed to operate and protect the service.</li>
                </ul>

                <h3>2. WhatsApp Document Import</h3>
                <p>
                    XerService allows a customer to link a WhatsApp number to their XerService account using a secure,
                    time-limited verification message. When a linked customer sends a supported document to the XerService
                    WhatsApp business number, XerService uses the sender information supplied by the WhatsApp Business Platform
                    to associate that document with the matching XerService customer account.
                </p>
                <p>
                    Documents received from a linked WhatsApp number are intended to appear only in the corresponding
                    authenticated XerService account. Customers can then review print settings, select a shop, add the
                    document to their cart, and continue with the print order.
                </p>

                <h3>3. How We Use Information</h3>
                <p>We use information to:</p>
                <ul>
                    <li>Create and manage customer, vendor, and administrator accounts.</li>
                    <li>Authenticate users and securely link WhatsApp numbers to XerService accounts.</li>
                    <li>Receive, validate, store, and display customer documents for requested printing services.</li>
                    <li>Prepare quotations, carts, payments, receipts, order updates, and print orders.</li>
                    <li>Provide customer support and resolve service, payment, or order issues.</li>
                    <li>Detect abuse, fraud, unauthorized access, technical failures, and security incidents.</li>
                    <li>Maintain and improve the performance and reliability of XerService.</li>
                </ul>

                <h3>4. Documents and Uploaded Files</h3>
                <p>
                    You retain ownership of documents you upload or send to XerService. We process those files only as
                    necessary to provide the printing service, support the order, comply with legal obligations, and
                    protect the platform.
                </p>
                <p>
                    Files may be made available to the print shop selected for your order only when required to fulfil
                    the printing request. Do not upload documents you do not have the right to use or print.
                </p>

                <h3>5. Sharing of Information</h3>
                <p>We may share limited information with:</p>
                <ul>
                    <li>The print shop or service provider selected to fulfil your order.</li>
                    <li>Service providers that support hosting, storage, authentication, communications, payments, security, and application infrastructure.</li>
                    <li>Meta/WhatsApp where required to operate the WhatsApp Business Platform integration.</li>
                    <li>Authorities or other parties when required by law, legal process, or to protect rights, safety, and platform security.</li>
                </ul>
                <p>We do not sell customer documents or WhatsApp message content to advertisers.</p>

                <h3>6. Payments</h3>
                <p>
                    Payments may be processed through authorised payment providers such as Razorpay. Payment providers
                    may process payment information under their own privacy and security terms. XerService receives only
                    the payment and transaction information needed to confirm and manage your order.
                </p>

                <h3>7. Storage, Retention, and Security</h3>
                <p>
                    We use access controls, authenticated APIs, private storage, webhook signature verification, and other
                    technical safeguards designed to protect customer information and uploaded documents.
                </p>
                <p>
                    Information is retained only for as long as reasonably necessary for the service, order fulfilment,
                    account management, support, fraud prevention, legal obligations, and dispute resolution. Temporary
                    WhatsApp-imported files may be automatically removed after their configured retention period.
                </p>

                <h3>8. Your Choices and Rights</h3>
                <p>
                    You may update certain account details through XerService. You may also disconnect a linked WhatsApp
                    number and remove eligible imported documents from your account.
                </p>
                <p>
                    To request access, correction, or deletion of personal information, contact us using the details below.
                    We may need to verify your identity before completing a request.
                </p>

                <h3>9. Data Deletion Instructions</h3>
                <p>
                    To request deletion of your XerService account and associated personal data, use the account deletion
                    option available in XerService where provided, or email <strong>xerserviceofficial@gmail.com</strong>
                    from the email address associated with your account with the subject <strong>Data Deletion Request</strong>.
                </p>
                <p>
                    Include enough information for us to identify the relevant account. After identity verification, we
                    will process the request subject to information that must be retained for legal, accounting, fraud
                    prevention, dispute, or security purposes.
                </p>

                <h3>10. Third-Party Services</h3>
                <p>
                    XerService may use third-party services including Meta/WhatsApp, payment providers, cloud hosting,
                    storage, and authentication providers. Their processing of information is also governed by their own
                    applicable privacy terms.
                </p>

                <h3>11. Children's Privacy</h3>
                <p>
                    XerService is not intended to knowingly collect personal information from children where parental or
                    guardian consent is legally required. If you believe such information has been provided improperly,
                    contact us so we can review the request.
                </p>

                <h3>12. Changes to This Policy</h3>
                <p>
                    We may update this Privacy Policy when our services, technology, or legal requirements change. The
                    latest version will be posted on this page with the updated date.
                </p>

                <h3>13. Contact Us</h3>
                <p>
                    XER SERVICE TECHNOLOGIES PRIVATE LIMITED<br />
                    Website: xerservice.in<br />
                    Email: xerserviceofficial@gmail.com<br />
                    Phone: 9092925065
                </p>
            </div>
        </article>
    );
}
