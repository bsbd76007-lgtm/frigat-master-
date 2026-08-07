'use client';

import { useEffect, useMemo, useState } from 'react';
import { useGameSocket } from '@/components/providers/GameSocketProvider';

const ROOMS = ['ENG', 'RUS', 'ARM'] as const;

type Room = (typeof ROOMS)[number];

type ChatMessage = {
  room: string;
  author: string;
  text: string;
  timestamp: number;
};

interface ChatSidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function ChatSidebar({ open, onClose }: ChatSidebarProps) {
  const { socket } = useGameSocket();
  const [activeRoom, setActiveRoom] = useState<Room>('ENG');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const unsubscribe = socket.subscribe('CHAT_MESSAGE', (data) => {
      const room = String(data.room ?? 'ENG').toUpperCase();
      const author = String(data.author ?? '');
      const text = String(data.text ?? '');
      const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
      setMessages((prev) => [
        { room, author, text, timestamp },
        ...prev,
      ].slice(0, 120));
    });
    return unsubscribe;
  }, [socket]);

  const filteredMessages = useMemo(
    () => messages.filter((message) => message.room === activeRoom),
    [activeRoom, messages]
  );

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || socket.status !== 'open') return;
    socket.send({ type: 'CHAT', payload: { room: activeRoom, text: trimmed } });
    setInput('');
  };

  return (
    <div className={`chat-drawer${open ? ' chat-drawer--open' : ''}`} aria-hidden={!open}>
      <div className="chat-drawer__header">
        <div>
          <h2>Chat</h2>
          <p className="chat-drawer__subtitle">Select a room and chat with other players.</p>
        </div>
        <button type="button" className="dash__btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="chat-drawer__rooms">
        {ROOMS.map((room) => (
          <button
            type="button"
            key={room}
            className={`chat-drawer__room${room === activeRoom ? ' chat-drawer__room--active' : ''}`}
            onClick={() => setActiveRoom(room)}
          >
            {room}
          </button>
        ))}
      </div>

      <div className="chat-drawer__body">
        {filteredMessages.length === 0 ? (
          <div className="chat-drawer__empty">
            <p>No messages yet in {activeRoom}.</p>
          </div>
        ) : (
          filteredMessages.map((message, index) => (
            <div key={`${message.timestamp}-${index}`} className="chat-drawer__message">
              <span className="chat-drawer__author">{message.author}</span>
              <span className="chat-drawer__text">{message.text}</span>
            </div>
          ))
        )}
      </div>

      <div className="chat-drawer__footer">
        <div className="chat-drawer__hint">
          Use <code>/tip @username amount</code> to send tokens.
        </div>
        <div className="chat-drawer__input-row">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder={`Message ${activeRoom}`}
            className="chat-drawer__input"
            disabled={socket.status !== 'open'}
          />
          <button
            type="button"
            className="dash__btn"
            onClick={sendMessage}
            disabled={socket.status !== 'open' || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
