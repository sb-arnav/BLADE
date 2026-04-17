import React from "react";

interface QuickActionsProps {
  onSend: (message: string) => void;
}

const actions = [
  { emoji: "💡", title: "Brainstorm", prompt: "Help me brainstorm ideas for:\n\nGoal:\nAudience or user:\nConstraints:\nWhat I have tried so far:\n" },
  { emoji: "📝", title: "Write", prompt: "Help me write this piece.\n\nType of writing:\nTopic:\nTone:\nTarget length:\nKey points to include:\n" },
  { emoji: "🐛", title: "Debug", prompt: "Help me debug this issue.\n\nExpected behavior:\nActual behavior:\nError message:\nRelevant code or steps:\n" },
  { emoji: "📊", title: "Analyze", prompt: "Analyze this for me:\n\nWhat it is:\nWhat you should look for:\nContext:\n" },
  { emoji: "🔍", title: "Research", prompt: "Research this topic for me:\n\nTopic:\nWhat decision I need to make:\nConstraints or preferences:\n" },
  { emoji: "⚡", title: "Explain", prompt: "Explain this clearly and simply:\n\nTopic:\nMy current understanding:\nWhat I am confused about:\n" },
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
