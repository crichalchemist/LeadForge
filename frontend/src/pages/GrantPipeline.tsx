import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, useDroppable, useDraggable } from '@dnd-kit/core';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchGrantBoard, transitionGrantStage } from '../api/client';
import { NOF_STAGE_LABELS, NOF_STAGE_COLORS } from '../types';
import type { GrantBoardColumn, GrantBoardCard } from '../types';

const SECTION_DIVIDERS: Record<string, string> = {
  eligibility_assessed: 'Pre-Application',
  finalist: 'Active Grant',
  alumnus: 'Complete',
};

export default function GrantPipeline() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [activeCard, setActiveCard] = useState<GrantBoardCard | null>(null);

  const { data } = useQuery<{ columns: GrantBoardColumn[] }>({
    queryKey: ['grantBoard'],
    queryFn: fetchGrantBoard,
    refetchInterval: 15_000,
  });

  const mutation = useMutation({
    mutationFn: ({ grantId, newStage }: { grantId: string; newStage: string }) =>
      transitionGrantStage(grantId, newStage),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grantBoard'] }),
  });

  function handleDragStart(event: DragStartEvent) {
    const card = findCard(event.active.id as string);
    setActiveCard(card ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const grantId = active.id as string;
    const newStage = over.id as string;
    const card = findCard(grantId);
    if (!card) return;

    const currentCol = data?.columns.find((c) =>
      c.cards.some((cd) => cd.grant_id === grantId)
    );
    if (currentCol?.stage === newStage) return;

    mutation.mutate({ grantId, newStage });
  }

  function findCard(grantId: string): GrantBoardCard | undefined {
    for (const col of data?.columns ?? []) {
      const card = col.cards.find((c) => c.grant_id === grantId);
      if (card) return card;
    }
    return undefined;
  }

  const columns = data?.columns ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Grant Pipeline</h1>
      <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.stage} className="flex-shrink-0">
              {SECTION_DIVIDERS[col.stage] && (
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 border-b border-gray-300 pb-1">
                  {SECTION_DIVIDERS[col.stage]}
                </div>
              )}
              <GrantColumn
                column={col}
                onCardClick={(grantId) => navigate(`/grants/${grantId}`)}
              />
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeCard ? <GrantCardContent card={activeCard} /> : null}
        </DragOverlay>
      </DndContext>
      {mutation.isError && (
        <p className="mt-4 text-sm text-red-600">
          Stage transition failed. The move may not be allowed.
        </p>
      )}
    </div>
  );
}

function GrantColumn({ column, onCardClick }: { column: GrantBoardColumn; onCardClick: (id: string) => void }) {
  const { setNodeRef } = useDroppable({ id: column.stage });

  return (
    <div ref={setNodeRef} className="w-56">
      <div className={`rounded-t-lg px-3 py-2 ${NOF_STAGE_COLORS[column.stage] || 'bg-gray-100'}`}>
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold text-gray-700 uppercase">
            {NOF_STAGE_LABELS[column.stage] || column.stage}
          </span>
          <span className="text-xs bg-white/70 px-1.5 py-0.5 rounded-full font-medium">
            {column.count}
          </span>
        </div>
      </div>
      <div className="bg-gray-50 rounded-b-lg min-h-[200px] p-2 space-y-2 border border-t-0 border-gray-200">
        {column.cards.map((card) => (
          <DraggableGrantCard key={card.grant_id} card={card} onClick={() => onCardClick(card.grant_id)} />
        ))}
      </div>
    </div>
  );
}

function DraggableGrantCard({ card, onClick }: { card: GrantBoardCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: card.grant_id,
  });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className="cursor-grab active:cursor-grabbing"
    >
      <GrantCardContent card={card} />
    </div>
  );
}

function GrantCardContent({ card }: { card: GrantBoardCard }) {
  return (
    <div className="bg-white rounded-md shadow-sm border border-gray-200 p-2.5 text-xs">
      <p className="font-medium text-gray-900 truncate">{card.business_name}</p>
      <div className="flex gap-2 mt-1 items-center">
        {card.corridor_name && (
          <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-medium truncate">
            {card.corridor_name}
          </span>
        )}
      </div>
      <div className="flex justify-between mt-1 text-gray-500">
        {card.estimated_grant != null && (
          <span>${card.estimated_grant.toLocaleString()}</span>
        )}
        <span>{card.days_in_stage}d</span>
      </div>
    </div>
  );
}
