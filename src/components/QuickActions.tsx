import React from "react";

interface QuickActionsProps {
  onSend: (message: string) => void;
}

const actions = [
  { emoji: "💡", title: "Brainstorm", prompt: "Help me brainstorm ideas for " },
  { emoji: "📝", title: "Write", prompt: "Write a " },
  { emoji: "🐛", title: "Debug", prompt: "Debug this: " },
  { emoji: "📊", title: "Analyze", prompt: "Analyze this: " },
  { emoji: "🔍", title: "Research", prompt: "Research " },
  { emoji: "⚡", title: "Explain", prompt: "Explain how " },
];

const QuickActions: React.FC<QuickActionsProps> = ({ onSend }) => {
  return (
    <div className="grid grid-cols-2 gap-2 animate-fade-in">
      {actions.map((action) => (
        <button
          key={action.title}
          onClick={() => onSend(action.prompt)}
          className="flex items-center gap-2 rounded-lg bg-blade-surface border border-blade-border hover:border-blade-accent/30 px-3 py-2 text-xs text-blade-secondary transition cursor-pointer text-left"
        >
          <span className="text-sm">{action.emoji}</span>
          <span>{action.title}</span>
        </button>
      ))}
    </div>
  );
};

export default QuickActions;
