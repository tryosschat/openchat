/**
 * Start Screen - T3.chat inspired welcome screen
 *
 * Features:
 * - Personalized time-based greeting (Good morning/afternoon/evening)
 * - Selectable category pills: Create, Explore, Code, Learn
 * - Suggestions change based on selected category
 * - Clicking a suggestion populates the input (doesn't auto-send)
 */

import { useState } from "react";
import { BookOpenIcon, ChevronRightIcon, CodeIcon, CompassIcon, PenLineIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-client";

// ============================================================================
// Types
// ============================================================================

interface StartScreenProps {
  onPromptSelect?: (prompt: string) => void;
  className?: string;
}

type Category = "create" | "explore" | "code" | "learn";

interface CategoryConfig {
  id: Category;
  label: string;
  icon: React.ReactNode;
}

// ============================================================================
// Constants
// ============================================================================

const CATEGORIES: Array<CategoryConfig> = [
  { id: "create", label: "Create", icon: <PenLineIcon className="size-4" /> },
  { id: "explore", label: "Explore", icon: <CompassIcon className="size-4" /> },
  { id: "code", label: "Code", icon: <CodeIcon className="size-4" /> },
  { id: "learn", label: "Learn", icon: <BookOpenIcon className="size-4" /> },
];

// Category-specific suggestions (shown when that category is selected)
const SUGGESTIONS_BY_CATEGORY: Record<Category, Array<string>> = {
  create: [
    "Write a short story about a robot discovering emotions",
    "Help me outline a sci-fi novel set in a post-apocalyptic world",
    "Create a character profile for a complex villain with sympathetic motives",
    "Give me 5 creative writing prompts for flash fiction",
  ],
  explore: [
    "Good books for fans of Rick Rubin",
    "Countries ranked by number of UNESCO World Heritage sites",
    "Most successful companies in the world by market cap",
    "How much does Claude cost compared to GPT-4?",
  ],
  code: [
    "Help me debug this React component",
    "Write a Python script to scrape data from a website",
    "Explain the difference between REST and GraphQL",
    "Review my TypeScript code for potential improvements",
  ],
  learn: [
    "Teach me about machine learning fundamentals",
    "Explain quantum computing in simple terms",
    "What should I know about starting a business?",
    "How does the stock market work?",
  ],
};

// ============================================================================
// Helpers
// ============================================================================

function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return "Good morning";
  } else if (hour >= 12 && hour < 17) {
    return "Good afternoon";
  } else {
    return "Good evening";
  }
}

function getFirstName(fullName: string | null | undefined): string {
  if (!fullName) return "";
  return fullName.split(" ")[0];
}

// ============================================================================
// Components
// ============================================================================

function CategoryPill({
  category,
  isActive,
  onClick,
}: {
  category: CategoryConfig;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2.5 md:py-2 rounded-full",
        "text-sm font-medium",
        "transition-all duration-200 active:scale-95",
        isActive
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {category.icon}
      <span>{category.label}</span>
    </button>
  );
}

function SuggestionItem({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center justify-between",
        "px-3 md:px-4 py-3.5 md:py-3 rounded-xl",
        "text-left text-sm md:text-[15px] text-foreground/80",
        "bg-transparent hover:bg-muted/50 active:bg-muted/70",
        "border border-transparent hover:border-border/30",
        "transition-all duration-200",
      )}
    >
      <span className="group-hover:text-foreground transition-colors">{text}</span>
      <ChevronRightIcon
        className={cn(
          "size-4 text-muted-foreground/40 shrink-0 ml-2 md:ml-3",
          "opacity-0 group-hover:opacity-100",
          "translate-x-0 group-hover:translate-x-1",
          "transition-all duration-200",
        )}
      />
    </button>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function StartScreen({ onPromptSelect, className }: StartScreenProps) {
  const { user } = useAuth();
  const firstName = getFirstName(user?.name);
  const greeting = getTimeBasedGreeting();

  // Track which category is selected (null = none selected, show default)
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  // Get suggestions based on selected category
  const currentSuggestions = selectedCategory
    ? SUGGESTIONS_BY_CATEGORY[selectedCategory]
    : [
        // Default suggestions (one from each category)
        SUGGESTIONS_BY_CATEGORY.create[0],
        SUGGESTIONS_BY_CATEGORY.explore[0],
        SUGGESTIONS_BY_CATEGORY.code[0],
        SUGGESTIONS_BY_CATEGORY.learn[0],
      ];

  const handleCategoryClick = (categoryId: Category) => {
    // Toggle selection - if already selected, deselect it
    setSelectedCategory((prev) => (prev === categoryId ? null : categoryId));
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center",
        "w-full max-w-3xl mx-auto",
        "pt-4 md:pt-16 pb-8",
        className,
      )}
    >
      {/* Greeting - Time-based with name */}
      <div className="mb-6 md:mb-8 text-center px-2">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1.5 md:mt-2 text-sm md:text-base text-muted-foreground">How can I help you today?</p>
      </div>

      {/* Category Pills - Selectable */}
      <div className="mb-6 md:mb-8 flex flex-wrap justify-center gap-1.5 md:gap-2 px-2">
        {CATEGORIES.map((category) => (
          <CategoryPill
            key={category.id}
            category={category}
            isActive={selectedCategory === category.id}
            onClick={() => handleCategoryClick(category.id)}
          />
        ))}
      </div>

      {/* Suggestions List - Changes based on selected category */}
      <div className="w-full max-w-lg space-y-0.5">
        {currentSuggestions.map((suggestion) => (
          <SuggestionItem
            key={suggestion}
            text={suggestion}
            onClick={() => onPromptSelect?.(suggestion)}
          />
        ))}
      </div>
    </div>
  );
}
