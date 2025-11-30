import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sendAssistantMessage } from '../api';

const initialBotMessage = {
    role: 'assistant',
    content:
        'Hallo! Ich kann dir helfen, neue Assets, Hypotheken und Transaktionen einzupflegen. Beschreibe einfach, was passiert ist, z.B. “Haus für CHF 1’000’000 gekauft, 200k vom ZKB Konto, Rest Hypothek 2% Zinsen p.a.”',
};

const AIAssistant = ({ currentScenarioId, accounts, scenarios, onDataChanged }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([initialBotMessage]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
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
            if (!resp?.plan) {
                setStatusNote('Kein automatischer Plan erkannt – bitte mehr Details geben.');
            }
            if (typeof onDataChanged === 'function') {
                await onDataChanged();
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

    const handleQuickStart = () => {
        setInput(
            'Hauskauf: CHF 1’000’000, 200’000 vom ZKB Konto, Rest Hypothek, 2% Zinsen p.a., Start 11/2025.'
        );
    };

    const renderTable = (tableData) => {
        if (!tableData) return null;
        const { headers, rows } = tableData;
        return (
            <div className="ai-table-wrapper">
                <table className="ai-table">
                    {headers?.length ? (
                        <thead>
                            <tr>
                                {headers.map((h, idx) => (
                                    <th key={idx}>{h || ' '}</th>
                                ))}
                            </tr>
                        </thead>
                    ) : null}
                    <tbody>
                        {rows.map((r, rIdx) => (
                            <tr key={rIdx}>
                                {r.map((cell, cIdx) => (
                                    <td key={cIdx}>{cell}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    const parsePipeTable = (lines) => {
        if (!lines || lines.length < 2) return null;
        const cleaned = lines
            .map((l) => l.trim())
            .filter((l) => l.startsWith('|'))
            .map((l) => l.replace(/^\|/, '').replace(/\|$/, ''));
        if (!cleaned.length) return null;
        const headerCells = cleaned[0].split('|').map((c) => c.trim());
        let dataLines = cleaned.slice(1);
        if (dataLines.length && /^-+/.test(dataLines[0].replace(/\|/g, '').trim())) {
            dataLines = dataLines.slice(1);
        }
        const rows = dataLines.map((l) => l.split('|').map((c) => c.trim()));
        return { headers: headerCells, rows };
    };

    const renderMessageContent = (msg) => {
        if (typeof msg?.content !== 'string') return msg?.content;
        if (msg.role !== 'assistant') return msg.content;
        // Strip fenced JSON blocks and Auto-apply status lines from assistant text
        let cleaned = msg.content.replace(/```json[\s\S]*?```/gi, '').trim();
        cleaned = cleaned
            .split('\n')
            .filter((line) => !/^\(auto-apply/i.test(line.trim()))
            .join('\n')
            .trim();
        const lines = cleaned.split('\n');
        const tableStart = lines.findIndex((l) => l.trim().startsWith('|') && l.includes('|'));
        if (tableStart === -1) {
            return <div className="ai-text">{cleaned}</div>;
        }
        let tableEnd = tableStart;
        while (tableEnd < lines.length && lines[tableEnd].trim().startsWith('|')) {
            tableEnd += 1;
        }
        const before = lines.slice(0, tableStart).join('\n').trim();
        const tableLines = lines.slice(tableStart, tableEnd);
        const after = lines.slice(tableEnd).join('\n').trim();
        const tableData = parsePipeTable(tableLines);

        return (
            <>
                {before && <div className="ai-text">{before}</div>}
                {renderTable(tableData)}
                {after && <div className="ai-text">{after}</div>}
            </>
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
                                {renderMessageContent(msg)}
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
