import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sendAssistantMessage, applyAssistantPlan } from '../api';

const initialBotMessage = {
    role: 'assistant',
    content:
        'Hallo! Ich kann dir helfen, neue Assets, Hypotheken und Transaktionen einzupflegen. Beschreibe einfach, was passiert ist, z.B. “Haus für CHF 1’000’000 gekauft, 200k vom ZKB Konto, Rest Hypothek 2% Zinsen p.a.”',
};

const AIAssistant = ({ currentScenarioId, accounts, scenarios }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([initialBotMessage]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [pendingPlan, setPendingPlan] = useState(null);
    const [statusNote, setStatusNote] = useState('');
    const bottomRef = useRef(null);

    const scenarioName = useMemo(
        () => scenarios.find((s) => s.id === currentScenarioId)?.name || 'Ohne Szenario',
        [scenarios, currentScenarioId]
    );

    useEffect(() => {
        if (isOpen && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen]);

    const appendMessage = (msg) => setMessages((prev) => [...prev, msg]);

    const handleSend = async (text = input) => {
        if (!text.trim()) return;
        const userMsg = { role: 'user', content: text.trim() };
        appendMessage(userMsg);
        setInput('');
        setLoading(true);
        setStatusNote('');
        try {
            const context = {
                scenario_id: currentScenarioId,
                scenario_name: scenarioName,
                accounts: (accounts || []).map((a) => ({
                    id: a.id,
                    name: a.name,
                    type: a.asset_type,
                    initial_balance: a.initial_balance,
                })),
            };
            const resp = await sendAssistantMessage([...messages, userMsg], context);
            if (resp?.messages?.length) {
                setMessages(resp.messages);
            } else {
                appendMessage({
                    role: 'assistant',
                    content: resp?.reply || 'Ich habe deine Anfrage verstanden.',
                });
            }
            setPendingPlan(resp?.plan || null);
            if (!resp?.plan) {
                setStatusNote('Kein automatischer Plan erkannt – bitte mehr Details geben oder manuell bestätigen.');
            }
        } catch (err) {
            appendMessage({
                role: 'assistant',
                content: `Fehler: ${err.message || 'Kann aktuell nicht antworten.'}`,
            });
            setStatusNote('Verbindung fehlgeschlagen. Später erneut versuchen.');
        } finally {
            setLoading(false);
        }
    };

    const handleApply = async () => {
        if (!pendingPlan) {
            setStatusNote('Kein Plan zum Anwenden vorhanden.');
            return;
        }
        setLoading(true);
        setStatusNote('Wende Plan an …');
        try {
            await applyAssistantPlan(pendingPlan);
            appendMessage({
                role: 'assistant',
                content: 'Plan angewendet. Die Änderungen sollten gleich sichtbar sein.',
            });
            setStatusNote('Fertig.');
        } catch (err) {
            appendMessage({
                role: 'assistant',
                content: `Konnte den Plan nicht anwenden: ${err.message}`,
            });
            setStatusNote('Bitte manuell prüfen oder später erneut versuchen.');
        } finally {
            setLoading(false);
        }
    };

    const handleQuickStart = () => {
        setInput(
            'Hauskauf: CHF 1’000’000, 200’000 vom ZKB Konto, Rest Hypothek, 2% Zinsen p.a., Start 11/2025.'
        );
    };

    return (
        <>
            <button
                className="ai-fab"
                type="button"
                onClick={() => setIsOpen((v) => !v)}
                aria-label="AI Assistent öffnen"
            >
                🤖 Assistent
            </button>

            {isOpen && (
                <div className="ai-drawer">
                    <div className="ai-header">
                        <div>
                            <p className="eyebrow">Assistant</p>
                            <h3>Magische Hand</h3>
                            <p className="muted small">Szenario: {scenarioName}</p>
                        </div>
                        <div className="ai-actions">
                            <button className="secondary" onClick={handleQuickStart}>
                                Beispiel laden
                            </button>
                            <button className="secondary" onClick={() => setIsOpen(false)}>
                                Schließen
                            </button>
                        </div>
                    </div>

                    <div className="ai-messages">
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`ai-bubble ${msg.role}`}>
                                {msg.content}
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </div>

                    <div className="ai-footer">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Beschreibe dein Ereignis oder stelle eine Frage..."
                            rows={3}
                        />
                        <div className="ai-footer-actions">
                            <button onClick={() => handleSend()} disabled={loading}>
                                Senden
                            </button>
                            <button className="secondary" onClick={handleApply} disabled={loading || !pendingPlan}>
                                Plan anwenden
                            </button>
                        </div>
                        {statusNote && <div className="muted small">{statusNote}</div>}
                        {loading && <div className="muted small">Denke nach …</div>}
                    </div>
                </div>
            )}
        </>
    );
};

export default AIAssistant;
