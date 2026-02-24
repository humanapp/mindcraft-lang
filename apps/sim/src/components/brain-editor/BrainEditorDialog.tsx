import { stream } from "@mindcraft-lang/core";
import { BrainDef, type BrainPageDef } from "@mindcraft-lang/core/brain/model";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Redo,
  RotateCcw,
  Save,
  Undo,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Archetype } from "@/brain/actor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { getDefaultBrain } from "@/services/brain-persistence";
import { BrainPageEditor } from "./BrainPageEditor";
import { BrainPrintDialog } from "./BrainPrintDialog";
import {
  AddPageCommand,
  BrainCommandHistory,
  RemovePageCommand,
  RenameBrainCommand,
  RenamePageCommand,
  ReplaceLastPageCommand,
} from "./commands";

export interface BrainEditorDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  srcBrainDef?: BrainDef;
  archetype?: Archetype;
  onSubmit: (newBrainDef: BrainDef) => void;
}

export function BrainEditorDialog({ isOpen, onOpenChange, srcBrainDef, archetype, onSubmit }: BrainEditorDialogProps) {
  // Clone the brainDef to work on a copy
  const [brainDef, setBrainDef] = useState<BrainDef | undefined>(() => {
    if (srcBrainDef) {
      const newBrainDef = srcBrainDef.clone();
      // Ensure at least one page exists
      if (newBrainDef.pages().size() === 0) {
        newBrainDef.appendNewPage();
      }
      return newBrainDef;
    }
    const newBrainDef = BrainDef.emptyBrainDef();
    // Ensure at least one page exists
    if (newBrainDef.pages().size() === 0) {
      newBrainDef.appendNewPage();
    }
    return newBrainDef;
  });
  const [currentPageNumber, setCurrentPageNumber] = useState(brainDef ? 1 : 0);
  const [totalPageCount, setTotalPageCount] = useState(brainDef?.pages()?.size() ?? 0);
  const [pageChangeCounter, setPageChangeCounter] = useState(0);
  const currentPageDef = brainDef ? brainDef.pages().get(currentPageNumber - 1) : undefined;

  // Command history for undo/redo
  const [commandHistory] = useState(() => new BrainCommandHistory());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isEditingBrainName, setIsEditingBrainName] = useState(false);
  const [brainNameValue, setBrainNameValue] = useState("");
  const [isEditingPageName, setIsEditingPageName] = useState(false);
  const [pageNameValue, setPageNameValue] = useState("");
  const [zoom, setZoom] = useState(1);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);

  // Update undo/redo state when history changes
  useEffect(() => {
    const updateUndoRedoState = () => {
      setCanUndo(commandHistory.canUndo());
      setCanRedo(commandHistory.canRedo());
    };

    commandHistory.onChange(updateUndoRedoState);
    updateUndoRedoState();
  }, [commandHistory]);

  // Clone brainDef when it changes or dialog opens
  useEffect(() => {
    if (isOpen && srcBrainDef) {
      const newBrainDef = srcBrainDef.clone();
      // Ensure at least one page exists
      if (newBrainDef.pages().size() === 0) {
        newBrainDef.appendNewPage();
      }
      setBrainDef(newBrainDef);
      setCurrentPageNumber(1);
      setTotalPageCount(newBrainDef.pages().size());
      commandHistory.clear(); // Clear history when opening dialog
    } else if (!isOpen) {
      // Clear working copy when dialog closes
      setBrainDef(undefined);
      commandHistory.clear();
    }
  }, [isOpen, srcBrainDef, commandHistory]);

  useEffect(() => {
    if (brainDef) {
      const onBrainChanged = ({
        what,
        pageWhat,
        ruleWhat,
      }: {
        what: string;
        pageWhat?: unknown;
        ruleWhat?: unknown;
      }) => {
        if (what === "page_added") {
          setTotalPageCount(brainDef.pages().size());
          setPageChangeCounter((c) => c + 1);
          if (currentPageNumber === 0) {
            setCurrentPageNumber(1);
          }
        } else if (what === "page_removed") {
          setTotalPageCount(brainDef.pages().size());
          setPageChangeCounter((c) => c + 1);
          setCurrentPageNumber((prev) => Math.min(prev, brainDef.pages().size()));
        }
      };

      const unsub = brainDef.events().on("brain_changed", onBrainChanged);
      return () => {
        unsub();
      };
    }
  }, [brainDef, currentPageNumber]);

  const handleSubmit = useCallback(() => {
    if (brainDef) {
      brainDef.purgeUnusedTiles();
    }
    onSubmit(brainDef || BrainDef.emptyBrainDef()!);
  }, [brainDef, onSubmit]);

  const handleInsertPageAfterCurrentClick = () => {
    if (brainDef && totalPageCount > 0) {
      const currentIndex = currentPageNumber - 1;
      const command = new AddPageCommand(brainDef, currentIndex + 1);
      commandHistory.executeCommand(command);
      setCurrentPageNumber(currentIndex + 2); // Move to the newly added page
    } else if (brainDef && totalPageCount === 0) {
      // If no pages exist, just append a new page
      const command = new AddPageCommand(brainDef);
      commandHistory.executeCommand(command);
      setCurrentPageNumber(1);
    }
  };

  const handleInsertPageBeforeCurrentClick = () => {
    if (brainDef && totalPageCount > 0) {
      const currentIndex = currentPageNumber - 1;
      const command = new AddPageCommand(brainDef, currentIndex);
      commandHistory.executeCommand(command);
      setCurrentPageNumber(currentIndex + 1); // Move to the newly added page
    } else if (brainDef && totalPageCount === 0) {
      // If no pages exist, just append a new page
      const command = new AddPageCommand(brainDef);
      commandHistory.executeCommand(command);
      setCurrentPageNumber(1);
    }
  };

  const handleRemovePageClick = () => {
    if (brainDef && totalPageCount > 0) {
      const pageIndexToRemove = currentPageNumber - 1;

      // Special case: if this is the last remaining page, use ReplaceLastPageCommand
      if (totalPageCount === 1) {
        const command = new ReplaceLastPageCommand(brainDef, pageIndexToRemove);
        commandHistory.executeCommand(command);
      } else {
        const command = new RemovePageCommand(brainDef, pageIndexToRemove);
        commandHistory.executeCommand(command);
      }

      // Immediately update state to reflect the change
      const newPageCount = brainDef.pages().size();
      setTotalPageCount(newPageCount);
      setPageChangeCounter((c) => c + 1);
      setCurrentPageNumber((prev) => Math.min(prev, newPageCount));
    }
  };

  const handleNextPageClick = () => {
    if (currentPageNumber < totalPageCount) {
      setCurrentPageNumber(currentPageNumber + 1);
    }
  };

  const handlePrevPageClick = () => {
    if (currentPageNumber > 1) {
      setCurrentPageNumber(currentPageNumber - 1);
    }
  };

  const handleUndo = useCallback(() => {
    commandHistory.undo();
  }, [commandHistory]);

  const handleRedo = useCallback(() => {
    commandHistory.redo();
  }, [commandHistory]);

  const handleSaveToFile = useCallback(async () => {
    if (!brainDef) return;

    try {
      // Serialize the brain to binary
      const memStream = new stream.MemoryStream();
      brainDef.serialize(memStream);
      const byteArray = memStream.toBytes();

      // Extract the underlying Uint8Array using the proper API
      const bytes = stream.byteArrayToUint8Array(byteArray);

      // Use File System Access API to save
      // biome-ignore lint/suspicious/noExplicitAny: File System Access API has no standard TS types
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${brainDef.name()}.brain`,
        types: [
          {
            description: "Brain Files",
            accept: { "application/octet-stream": [".brain"] },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    } catch (err) {
      // User cancelled or error occurred
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Failed to save brain:", err);
      }
    }
  }, [brainDef]);

  const handleLoadFromFile = useCallback(async () => {
    try {
      // Use File System Access API to load
      // biome-ignore lint/suspicious/noExplicitAny: File System Access API has no standard TS types
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: "Brain Files",
            accept: { "application/octet-stream": [".brain"] },
          },
        ],
        multiple: false,
      });

      const file = await handle.getFile();
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Convert Uint8Array to IByteArray using the proper API
      const byteArray = stream.byteArrayFromUint8Array(uint8Array);

      // Deserialize the brain from binary
      const memStream = new stream.MemoryStream(byteArray);
      const loadedBrain = new BrainDef();
      loadedBrain.deserialize(memStream);

      // Ensure at least one page exists
      if (loadedBrain.pages().size() === 0) {
        loadedBrain.appendNewPage();
      }

      loadedBrain.compile();

      setBrainDef(loadedBrain);
      setCurrentPageNumber(1);
      setTotalPageCount(loadedBrain.pages().size());
      commandHistory.clear();
    } catch (err) {
      // User cancelled or error occurred
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Failed to load brain:", err);
      }
    }
  }, [commandHistory]);

  const handleLoadDefault = useCallback(() => {
    if (!archetype) return;
    const defaultBrain = getDefaultBrain(archetype);
    if (!defaultBrain) return;

    const cloned = defaultBrain.clone();
    if (cloned.pages().size() === 0) {
      cloned.appendNewPage();
    }
    cloned.compile();

    setBrainDef(cloned);
    setCurrentPageNumber(1);
    setTotalPageCount(cloned.pages().size());
    commandHistory.clear();
  }, [archetype, commandHistory]);

  const handleBrainNameClick = () => {
    if (brainDef) {
      setBrainNameValue(brainDef.name());
      setIsEditingBrainName(true);
    }
  };

  const handleBrainNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBrainNameValue(e.target.value);
  };

  const handleBrainNameBlur = () => {
    const trimmedValue = brainNameValue.trim();
    if (brainDef && trimmedValue && trimmedValue !== brainDef.name()) {
      const command = new RenameBrainCommand(brainDef, trimmedValue);
      commandHistory.executeCommand(command);
    }
    setIsEditingBrainName(false);
  };

  const handleBrainNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Stop propagation to prevent dialog shortcuts from interfering
    e.stopPropagation();

    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setIsEditingBrainName(false);
    }
  };

  const handlePageNameClick = () => {
    if (currentPageDef) {
      setPageNameValue(currentPageDef.name());
      setIsEditingPageName(true);
    }
  };

  const handlePageNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageNameValue(e.target.value);
  };

  const handlePageNameBlur = () => {
    const trimmedValue = pageNameValue.trim();
    if (currentPageDef && trimmedValue && trimmedValue !== currentPageDef.name()) {
      const command = new RenamePageCommand(currentPageDef as BrainPageDef, trimmedValue);
      commandHistory.executeCommand(command);
    }
    setIsEditingPageName(false);
  };

  const handlePageNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Stop propagation to prevent parent handlers from interfering
    e.stopPropagation();

    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setIsEditingPageName(false);
    }
  };

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (modKey && (e.key === "Z" || (e.shiftKey && e.key === "z"))) {
        e.preventDefault();
        handleRedo();
      } else if (modKey && e.key === "y") {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleUndo, handleRedo]);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-[75%] h-[75%] flex flex-col bg-slate-100 border-2 border-slate-300 rounded-2xl"
          onInteractOutside={(e) => e.preventDefault()}
          hideClose
        >
          <DialogHeader className="border-b border-slate-200 pb-4">
            <DialogTitle>
              <div className="flex justify-center items-center gap-3">
                {/* biome-ignore lint/a11y/useSemanticElements: refactoring to fieldset would require restructuring large JSX blocks */}
                <div
                  className="flex bg-white rounded-lg p-1.5 border border-slate-200"
                  role="group"
                  aria-label="Brain name controls"
                >
                  <img
                    src="/assets/brain/icons/page.svg"
                    alt="Page icon"
                    className="h-8 w-8 bg-slate-300 rounded-sm"
                    aria-hidden="true"
                  />
                  <div className="flex items-center gap-1">
                    {isEditingPageName ? (
                      <>
                        <Input
                          value={pageNameValue}
                          onChange={handlePageNameChange}
                          onBlur={handlePageNameBlur}
                          onKeyDown={handlePageNameKeyDown}
                          autoFocus
                          className="text-slate-800 font-semibold h-8 px-2 py-1 max-w-xs bg-white border-slate-300 focus-visible:ring-slate-400"
                        />
                        <Button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handlePageNameBlur();
                          }}
                          className="h-8 w-8 min-w-8 p-0 bg-green-500 hover:bg-green-600 text-white rounded-sm"
                          title="Save page name"
                          aria-label="Save page name"
                        >
                          <Save className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="text-slate-800 font-semibold cursor-pointer hover:bg-slate-200 px-2 py-1 rounded bg-transparent"
                          onClick={handlePageNameClick}
                          title="Click to edit page name"
                        >
                          {currentPageDef ? currentPageDef.name() : "Page"}
                        </button>
                        <Button
                          onClick={handlePageNameClick}
                          className="h-8 w-8 bg-white hover:bg-slate-50 text-slate-700 rounded-md border border-slate-300"
                          title="Edit page name"
                          aria-label="Edit page name"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="grow" />
                {/* biome-ignore lint/a11y/useSemanticElements: refactoring to fieldset would require restructuring large JSX blocks */}
                <div
                  className="flex bg-white rounded-lg p-1.5 border border-slate-200"
                  role="group"
                  aria-label="Brain name controls"
                >
                  <img
                    src="/assets/brain/icons/brain2.svg"
                    alt="Brain icon"
                    className="h-8 w-8 bg-slate-300 rounded-sm"
                    aria-hidden="true"
                  />
                  <div className="flex items-center gap-1">
                    {isEditingBrainName ? (
                      <>
                        <Input
                          value={brainNameValue}
                          onChange={handleBrainNameChange}
                          onBlur={handleBrainNameBlur}
                          onKeyDown={handleBrainNameKeyDown}
                          autoFocus
                          className="text-slate-800 font-semibold h-8 px-2 py-1 max-w-xs bg-white border-slate-300 focus-visible:ring-slate-400"
                        />
                        <Button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleBrainNameBlur();
                          }}
                          className="h-8 w-8 min-w-8 p-0 bg-green-500 hover:bg-green-600 text-white rounded-sm"
                          title="Save brain name"
                          aria-label="Save brain name"
                        >
                          <Save className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="text-slate-800 font-semibold cursor-pointer hover:bg-slate-200 px-2 py-1 rounded bg-transparent"
                          onClick={handleBrainNameClick}
                          title="Click to edit brain name"
                        >
                          {brainDef ? brainDef.name() : "Brain Editor"}
                        </button>
                        <Button
                          onClick={handleBrainNameClick}
                          className="h-8 w-8 bg-white hover:bg-slate-50 text-slate-700 rounded-md border border-slate-300"
                          title="Edit brain name"
                          aria-label="Edit brain name"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="grow" />
                {/* biome-ignore lint/a11y/useSemanticElements: refactoring to fieldset would require restructuring large JSX blocks */}
                <div
                  className="flex items-center gap-2 bg-white rounded-lg p-1.5 border border-slate-200 mr-2"
                  role="group"
                  aria-label="Undo and redo controls"
                >
                  <Button
                    className="h-8 w-8 px-3 bg-slate-500 hover:bg-slate-600 text-white rounded-md disabled:opacity-50"
                    onClick={handleUndo}
                    disabled={!canUndo}
                    title="Undo (Ctrl/Cmd+Z)"
                    aria-label="Undo last action"
                  >
                    <Undo className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    className="h-8 w-8 px-3 bg-slate-500 hover:bg-slate-600 text-white rounded-md disabled:opacity-50"
                    onClick={handleRedo}
                    disabled={!canRedo}
                    title="Redo (Ctrl/Cmd+Shift+Z)"
                    aria-label="Redo last undone action"
                  >
                    <Redo className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                {/* biome-ignore lint/a11y/useSemanticElements: refactoring to fieldset would require restructuring large JSX blocks */}
                <div
                  className="flex items-center gap-2 bg-white rounded-lg p-1.5 border border-slate-200"
                  role="group"
                  aria-label="Page navigation controls"
                >
                  <Button
                    title="Previous Page"
                    className="h-8 w-8 bg-white hover:bg-slate-50 text-slate-700 rounded-md border border-slate-300"
                    onClick={handlePrevPageClick}
                    aria-label="Go to previous page"
                    disabled={currentPageNumber <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1 px-3 h-8 text-sm font-medium text-slate-700 whitespace-nowrap bg-white hover:bg-slate-50 rounded-md border border-slate-300 cursor-pointer"
                        aria-live="polite"
                        aria-atomic="true"
                        aria-label={`Page ${currentPageNumber} of ${totalPageCount}. Click to select a page.`}
                      >
                        {`Page ${currentPageNumber} of ${totalPageCount}`}
                        <ChevronDown className="h-3 w-3 ml-1 text-slate-400" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="center"
                      className="bg-white border-slate-300 text-slate-700 max-h-64 overflow-y-auto"
                    >
                      {brainDef
                        ?.pages()
                        .toArray()
                        .map((page, index) => (
                          <DropdownMenuItem
                            key={`page-${page.name()}-${index}`}
                            onClick={() => setCurrentPageNumber(index + 1)}
                            className={`cursor-pointer focus:bg-slate-100 focus:text-slate-900 ${
                              index + 1 === currentPageNumber ? "bg-slate-100 font-semibold" : ""
                            }`}
                          >
                            <span className="text-slate-400 text-xs w-6 text-right mr-2">{index + 1}</span>
                            {page.name()}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    title="Next Page"
                    className="h-8 w-8 bg-white hover:bg-slate-50 text-slate-700 rounded-md border border-slate-300"
                    onClick={handleNextPageClick}
                    aria-label="Go to next page"
                    disabled={currentPageNumber >= totalPageCount}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        title="Page Actions"
                        className="h-8 w-8 bg-white hover:bg-slate-50 text-slate-700 rounded-md border border-slate-300"
                        variant="default"
                        aria-label="Open page actions menu"
                        aria-haspopup="menu"
                      >
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-white border-slate-300 text-slate-700">
                      <DropdownMenuItem
                        onClick={handleLoadDefault}
                        disabled={!archetype || !getDefaultBrain(archetype)}
                        className="cursor-pointer focus:bg-slate-100 focus:text-slate-900"
                      >
                        <div className="flex text-center items-center border rounded-md h-8 min-w-8 border-slate-300">
                          <RotateCcw className="h-4 grow mx-1" />
                        </div>
                        <span className="w-full">Load Default Brain</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleLoadFromFile}
                        className="cursor-pointer focus:bg-slate-100 focus:text-slate-900"
                      >
                        <div className="flex text-center items-center border rounded-md h-8 min-w-8 border-slate-300">
                          <Upload className="h-4 grow mx-1" />
                        </div>
                        <span className="w-full">Load Brain from File</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleSaveToFile}
                        disabled={!brainDef}
                        className="cursor-pointer focus:bg-slate-100 focus:text-slate-900"
                      >
                        <div className="flex text-center items-center border rounded-md h-8 min-w-8 border-slate-300">
                          <Download className="h-4 grow mx-1" />
                        </div>
                        <span className="w-full">Save Brain to File</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setIsPrintDialogOpen(true)}
                        disabled={!brainDef}
                        className="cursor-pointer focus:bg-slate-100 focus:text-slate-900"
                      >
                        <div className="flex text-center items-center border rounded-md h-8 min-w-8 border-slate-300">
                          <Printer className="h-4 grow mx-1" />
                        </div>
                        <span className="w-full">Print Brain</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-slate-200" />
                      <DropdownMenuItem
                        onClick={handleInsertPageBeforeCurrentClick}
                        className="cursor-pointer focus:bg-slate-100 focus:text-slate-900"
                      >
                        <div className="flex text-center items-center border rounded-md h-8 border-slate-300">
                          <ChevronLeft className="h-4 w-4 ml-1" />
                          <Plus className="h-4 w-4 mr-1" />
                        </div>
                        <span className="w-full">Add Page Before</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleInsertPageAfterCurrentClick}
                        className="cursor-pointer focus:bg-slate-100 focus:text-slate-900"
                      >
                        <div className="flex text-center items-center border rounded-md h-8 border-slate-300">
                          <Plus className="h-4 w-4 ml-1" />
                          <ChevronRight className="h-4 w-4 mr-1" />
                        </div>
                        <span className="w-full">Add Page After</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-slate-200" />
                      <DropdownMenuItem
                        onClick={handleRemovePageClick}
                        className="cursor-pointer text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                      >
                        <div className="flex text-center items-center border rounded-md h-8 min-w-8 border-slate-300">
                          <Minus className="h-4 grow mx-1" />
                        </div>
                        <span className="w-full">Delete Page</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>
          {/* biome-ignore lint/a11y/useSemanticElements: refactoring to section would require restructuring large JSX blocks */}
          <div
            className="overflow-hidden grow rounded-lg"
            style={{
              background: "linear-gradient(55deg, #1E1B4B 0%, #A78BFA 100%)",
              boxShadow: "inset 0 0 0 2px rgba(255, 255, 255, 0.25)",
            }}
            role="region"
            aria-label="Brain page editor content"
          >
            {brainDef && currentPageDef ? (
              <BrainPageEditor
                key={`${currentPageNumber}-${pageChangeCounter}`}
                pageDef={currentPageDef as BrainPageDef}
                pageNumber={currentPageNumber}
                commandHistory={commandHistory}
                zoom={zoom}
              />
            ) : (
              <p className="text-slate-600 p-6">No BrainDef attached to this object.</p>
            )}
          </div>
          <DialogFooter className="pt-4 border-t border-slate-200 flex flex-row items-center sm:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-slate-500 whitespace-nowrap">{Math.round(zoom * 100)}%</span>
              <Slider
                className="w-32"
                min={0.5}
                max={3}
                step={0.1}
                value={[zoom]}
                onValueChange={([v]) => setZoom(v)}
                aria-label="Zoom level"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="cancel"
                className="rounded-lg"
                onClick={() => onOpenChange(false)}
                title="Discard Changes"
              >
                Cancel
              </Button>
              <Button
                title="Save Changes"
                className="rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white"
                onClick={handleSubmit}
                disabled={!brainDef}
              >
                OK
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {brainDef && (
        <BrainPrintDialog isOpen={isPrintDialogOpen} onOpenChange={setIsPrintDialogOpen} brainDef={brainDef} />
      )}
    </>
  );
}
