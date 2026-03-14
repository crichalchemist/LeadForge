import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, useDroppable, useDraggable } from '@dnd-kit/core';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPipelineBoard, transitionStage } from '../api/client';
import { STAGE_LABELS, STAGE_COLORS } from '../types';
import type { PipelineColumn, PipelineCard } from '../types';

export default function Pipeline() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);

  const { data } = useQuery<{ columns: PipelineColumn[] }>({
    queryKey: ['pipeline'],
    queryFn: fetchPipelineBoard,
    refetchInterval: 15_000,
  });

  const mutation = useMutation({
    mutationFn: ({ outreachId, newStage }: { outreachId: string; newStage: string }) =>
      transitionStage(outreachId, newStage),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
  });

  function handleDragStart(event: DragStartEvent) {
    const card = findCard(event.active.id as string);
    setActiveCard(card ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const outreachId = active.id as string;
    const newStage = over.id as string;
    const card = findCard(outreachId);
    if (!card) return;

    // Find current stage
    const currentCol = data?.columns.find((c) =>
      c.cards.some((cd) => cd.outreach_id === outreachId)
    );
    if (currentCol?.stage === newStage) return;

    mutation.mutate({ outreachId, newStage });
  }

  function findCard(outreachId: string): PipelineCard | undefined {
    for (const col of data?.columns ?? []) {
      const card = col.cards.find((c) => c.outreach_id === outreachId);
      if (card) return card;
    }
    return undefined;
  }

  const columns = data?.columns ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Pipeline Board</h1>
      <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((col) => (
            <Column
              key={col.stage}
              column={col}
              onCardClick={(businessId) => navigate(`/leads/${businessId}`)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCard ? <CardContent card={activeCard} /> : null}
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

function Column({ column, onCardClick }: { column: PipelineColumn; onCardClick: (id: string) => void }) {
  const { setNodeRef } = useDroppable({ id: column.stage });

  return (
    <div ref={setNodeRef} className="flex-shrink-0 w-56">
      <div className={`rounded-t-lg px-3 py-2 ${STAGE_COLORS[column.stage] || 'bg-gray-100'}`}>
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold text-gray-700 uppercase">
            {STAGE_LABELS[column.stage] || column.stage}
          </span>
          <span className="text-xs bg-white/70 px-1.5 py-0.5 rounded-full font-medium">
            {column.count}
          </span>
        </div>
      </div>
      <div className="bg-gray-50 rounded-b-lg min-h-[200px] p-2 space-y-2 border border-t-0 border-gray-200">
        {column.cards.map((card) => (
          <DraggableCard key={card.outreach_id} card={card} onClick={() => onCardClick(card.business_id)} />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({ card, onClick }: { card: PipelineCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: card.outreach_id,
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
      <CardContent card={card} />
    </div>
  );
}

function CardContent({ card }: { card: PipelineCard }) {
  return (
    <div className="bg-white rounded-md shadow-sm border border-gray-200 p-2.5 text-xs">
      <p className="font-medium text-gray-900 truncate">{card.business_name}</p>
      <div className="flex gap-2 mt-1 text-gray-500">
        <span>{card.zip_code}</span>
        {card.niche && <span className="capitalize">{card.niche.replace('_', ' ')}</span>}
      </div>
      {card.call_attempts > 0 && (
        <p className="text-gray-400 mt-1">{card.call_attempts} call(s)</p>
      )}
    </div>
  );
}
