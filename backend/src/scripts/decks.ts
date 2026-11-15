import { randomUUID } from "node:crypto";

export type CliArgs = {
  command: "list" | "create" | "edit" | "delete" | "cards" | "reviews" | "help";
  cardCommand?: "list" | "show" | "add" | "delete";
  reviewCommand?: "recent" | "stats";
  target?: string;
  deck?: string;
  knowledge?: string;
  owner?: string;
  language?: string;
  name?: string;
  paused?: boolean;
  starred?: boolean;
  all: boolean;
  yes: boolean;
  limit: number;
};

const usage = `RemLang deck manager

  npm run deck -- list [--all] [--owner USER_ID]
  npm run deck -- create "Deck name" [--language lang_ja] [--owner USER_ID]
  npm run deck -- edit ID_OR_NAME [--name "New name"] [--paused true|false] [--starred true|false]
  npm run deck -- delete ID_OR_NAME --yes

  npm run deck -- cards list [DECK_ID_OR_NAME] [--all]
  npm run deck -- cards show CARD_ID_OR_EXACT_FRONT
  npm run deck -- cards add --deck DECK_ID_OR_NAME --knowledge KNOWLEDGE_ID_OR_EXACT_FRONT[,ID...]
  npm run deck -- cards delete CARD_ID --yes

  npm run deck -- reviews recent [DECK_ID_OR_NAME] [--limit 50]
  npm run deck -- reviews stats [DECK_ID_OR_NAME]

Run a sync in RemLang before and after making changes.`;

const readBoolean = (flag: string, value?: string) => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} must be true or false.`);
};

export const parseArgs = (argv: string[]): CliArgs => {
  const [rawCommand = "help", ...rawRest] = argv;
  if (rawCommand === "help" || rawCommand === "--help" || rawCommand === "-h") {
    return { command: "help", all: false, yes: false, limit: 50 };
  }
  if (!["list", "create", "edit", "delete", "cards", "reviews"].includes(rawCommand)) {
    throw new Error(`Unknown command: ${rawCommand}`);
  }

  const rest = [...rawRest];
  const cardCommand = rawCommand === "cards" ? rest.shift() : undefined;
  const reviewCommand = rawCommand === "reviews" ? rest.shift() : undefined;
  if (rawCommand === "cards" && !["list", "show", "add", "delete"].includes(cardCommand ?? "")) {
    throw new Error("Cards requires list, show, add, or delete.");
  }
  if (rawCommand === "reviews" && !["recent", "stats"].includes(reviewCommand ?? "")) {
    throw new Error("Reviews requires recent or stats.");
  }

  const positional: string[] = [];
  const result: CliArgs = {
    command: rawCommand as CliArgs["command"],
    cardCommand: cardCommand as CliArgs["cardCommand"],
    reviewCommand: reviewCommand as CliArgs["reviewCommand"],
    all: false,
    yes: false,
    limit: 50,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (arg === "--all") result.all = true;
    else if (arg === "--yes") result.yes = true;
    else {
      const value = rest[++index];
      if (!value || value.startsWith("--")) throw new Error(`Expected a value after ${arg}.`);
      if (arg === "--owner") result.owner = value;
      else if (arg === "--language") result.language = value;
      else if (arg === "--name") result.name = value;
      else if (arg === "--deck") result.deck = value;
      else if (arg === "--knowledge") result.knowledge = value;
      else if (arg === "--limit") {
        result.limit = Number(value);
        if (!Number.isInteger(result.limit) || result.limit < 1 || result.limit > 1000) {
          throw new Error("--limit must be an integer from 1 to 1000.");
        }
      }
      else if (arg === "--paused") result.paused = readBoolean(arg, value);
      else if (arg === "--starred") result.starred = readBoolean(arg, value);
      else throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (result.command === "create") result.name = positional.join(" ").trim();
  else if (result.command === "cards") result.target = positional.join(" ").trim() || undefined;
  else if (result.command === "reviews") result.target = positional.join(" ").trim() || undefined;
  else if (result.command !== "list") result.target = positional.join(" ").trim();

  if (result.command === "create" && !result.name) throw new Error("Deck name is required.");
  if (result.name !== undefined && !result.name.trim()) throw new Error("Deck name cannot be blank.");
  if (["edit", "delete"].includes(result.command) && !result.target) {
    throw new Error("Deck ID or exact name is required.");
  }
  if (result.command === "edit" && result.name === undefined && result.paused === undefined && result.starred === undefined) {
    throw new Error("Edit requires --name, --paused, or --starred.");
  }
  if (result.command === "delete" && !result.yes) {
    throw new Error("Delete moves the deck to Trash. Re-run with --yes to confirm.");
  }
  if (result.command === "cards" && ["show", "delete"].includes(result.cardCommand!) && !result.target) {
    throw new Error("Card ID or exact front is required.");
  }
  if (result.command === "cards" && result.cardCommand === "add" && (!result.deck || !result.knowledge)) {
    throw new Error("Cards add requires --deck and --knowledge.");
  }
  if (result.command === "cards" && result.cardCommand === "delete" && !result.yes) {
    throw new Error("Re-run card deletion with --yes to confirm.");
  }
  return result;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    console.log(usage);
    return;
  }

  const [{ db }, schema, drizzle] = await Promise.all([
    import("../db/client"),
    import("../db/schema"),
    import("drizzle-orm"),
  ]);
  const { syncUsers, syncDecks, syncDeckLinks, syncCards, syncKnowledge } = schema;
  const { and, eq, inArray, isNotNull, isNull, or, sql } = drizzle;

  let owner = args.owner;
  if (!owner) {
    const users = await db.select({ id: syncUsers.id }).from(syncUsers).limit(2);
    if (users.length !== 1) throw new Error("Pass --owner USER_ID because the database has zero or multiple users.");
    owner = users[0].id;
  }

  if (args.command === "reviews") {
    let deckId: string | null = null;
    if (args.target) {
      const decks = await db
        .select({ id: syncDecks.id, name: syncDecks.name })
        .from(syncDecks)
        .where(and(
          eq(syncDecks.ownerId, owner),
          isNull(syncDecks.deletedAt),
          or(eq(syncDecks.id, args.target), eq(syncDecks.name, args.target)),
        ))
        .limit(2);
      if (decks.length === 0) throw new Error(`No active deck matches: ${args.target}`);
      if (decks.length > 1) throw new Error(`More than one deck is named ${args.target}; use its ID.`);
      deckId = decks[0].id;
    }

    if (args.reviewCommand === "recent") {
      const rows = await db.execute(sql`
        select
          log.id,
          log.review,
          knowledge.front,
          knowledge.pronunciation,
          knowledge.entry_id as "entryId",
          knowledge.review_type as "reviewType",
          log.rating,
          log.state,
          log.due,
          log.stability,
          log.difficulty,
          log.elapsed_days as "elapsedDays",
          log.scheduled_days as "scheduledDays",
          log.learning_steps as "learningSteps",
          log.last_elapsed_days as "lastElapsedDays",
          (to_jsonb(log)->>'duration_ms')::bigint as "timeSpentMs"
        from sync_review_logs log
        join sync_knowledge knowledge
          on knowledge.owner_id = log.owner_id and knowledge.id = log.knowledge_id
        where log.owner_id = ${owner}
          and not log.deleted
          and (${deckId}::text is null or exists (
            select 1 from sync_cards card
            where card.owner_id = log.owner_id
              and card.knowledge_id = log.knowledge_id
              and card.deck_id = ${deckId}
          ))
        order by log.review desc
        limit ${args.limit}
      `);
      console.table(rows);
      return;
    }

    const [aggregate] = await db.execute(sql`
      select
        count(*)::int as "reviewCount",
        count(distinct log.knowledge_id)::int as "knowledgeReviewed",
        count(*) filter (where log.rating = 'Again')::int as "again",
        count(*) filter (where log.rating = 'Hard')::int as "hard",
        count(*) filter (where log.rating = 'Good')::int as "good",
        count(*) filter (where log.rating = 'Easy')::int as "easy",
        count(*) filter (where log.state = 'Learning')::int as "learningReviews",
        count(*) filter (where log.state = 'Review')::int as "reviewStateReviews",
        count(*) filter (where log.state = 'Relearning')::int as "relearningReviews",
        round(avg(log.stability)::numeric, 3) as "averageStability",
        round(avg(log.difficulty)::numeric, 3) as "averageDifficulty",
        round(avg(log.scheduled_days)::numeric, 3) as "averageScheduledDays",
        min(log.review) as "firstReview",
        max(log.review) as "lastReview",
        sum((to_jsonb(log)->>'duration_ms')::bigint)::bigint as "timeSpentMs"
      from sync_review_logs log
      where log.owner_id = ${owner}
        and not log.deleted
        and (${deckId}::text is null or exists (
          select 1 from sync_cards card
          where card.owner_id = log.owner_id
            and card.knowledge_id = log.knowledge_id
            and card.deck_id = ${deckId}
        ))
    `);
    console.log(JSON.stringify({
      scope: args.target ?? "all decks",
      ...aggregate,
      timeTracking: aggregate?.timeSpentMs === null
        ? "Not recorded for these reviews; exact historical time cannot be reconstructed."
        : "milliseconds",
    }, null, 2));

    const cards = await db.execute(sql`
      select
        card.id as "cardId",
        deck.name as deck,
        knowledge.id as "knowledgeId",
        knowledge.front,
        knowledge.pronunciation,
        knowledge.entry_id as "entryId",
        knowledge.review_type as "reviewType",
        knowledge.state,
        knowledge.due,
        knowledge.last_review as "lastReview",
        knowledge.stability,
        knowledge.difficulty,
        knowledge.elapsed_days as "elapsedDays",
        knowledge.scheduled_days as "scheduledDays",
        knowledge.learning_steps as "learningSteps",
        knowledge.reps,
        knowledge.lapses,
        knowledge.suspended,
        count(log.id)::int as reviews,
        count(log.id) filter (where log.rating = 'Again')::int as again,
        count(log.id) filter (where log.rating = 'Hard')::int as hard,
        count(log.id) filter (where log.rating = 'Good')::int as good,
        count(log.id) filter (where log.rating = 'Easy')::int as easy,
        sum((to_jsonb(log)->>'duration_ms')::bigint)::bigint as "timeSpentMs"
      from sync_cards card
      join sync_decks deck on deck.owner_id = card.owner_id and deck.id = card.deck_id
      join sync_knowledge knowledge on knowledge.owner_id = card.owner_id and knowledge.id = card.knowledge_id
      left join sync_review_logs log
        on log.owner_id = knowledge.owner_id and log.knowledge_id = knowledge.id and not log.deleted
      where card.owner_id = ${owner}
        and card.deleted_at is null
        and (${deckId}::text is null or card.deck_id = ${deckId})
      group by card.id, deck.name, knowledge.owner_id, knowledge.id
      order by deck.name, knowledge.front
    `);
    console.table(cards);
    return;
  }

  if (args.command === "cards") {
    let deckId: string | undefined;
    const deckTarget = args.deck ?? (args.cardCommand === "list" ? args.target : undefined);
    if (deckTarget) {
      const decks = await db
        .select({ id: syncDecks.id, name: syncDecks.name })
        .from(syncDecks)
        .where(and(
          eq(syncDecks.ownerId, owner),
          isNull(syncDecks.deletedAt),
          or(eq(syncDecks.id, deckTarget), eq(syncDecks.name, deckTarget)),
        ))
        .limit(2);
      if (decks.length === 0) throw new Error(`No active deck matches: ${deckTarget}`);
      if (decks.length > 1) throw new Error(`More than one deck is named ${deckTarget}; use its ID.`);
      deckId = decks[0].id;
    }

    if (args.cardCommand === "list") {
      const rows = await db
        .select({
          id: syncCards.id,
          knowledgeId: syncCards.knowledgeId,
          deck: syncDecks.name,
          front: syncKnowledge.front,
          pronunciation: syncKnowledge.pronunciation,
          entryId: syncKnowledge.entryId,
          reviewType: syncKnowledge.reviewType,
          state: syncKnowledge.state,
          due: syncKnowledge.due,
          deletedAt: syncCards.deletedAt,
        })
        .from(syncCards)
        .innerJoin(syncDecks, and(eq(syncDecks.ownerId, syncCards.ownerId), eq(syncDecks.id, syncCards.deckId)))
        .innerJoin(syncKnowledge, and(eq(syncKnowledge.ownerId, syncCards.ownerId), eq(syncKnowledge.id, syncCards.knowledgeId)))
        .where(and(
          eq(syncCards.ownerId, owner),
          deckId ? eq(syncCards.deckId, deckId) : undefined,
          args.all ? undefined : isNull(syncCards.deletedAt),
        ))
        .orderBy(syncDecks.name, syncKnowledge.front);
      console.table(rows);
      return;
    }

    if (args.cardCommand === "add") {
      const knowledgeIds = args.knowledge!.split(",").map((value) => value.trim()).filter(Boolean);
      const knowledgeRows = await db
        .select({ id: syncKnowledge.id, front: syncKnowledge.front })
        .from(syncKnowledge)
        .where(and(
          eq(syncKnowledge.ownerId, owner),
          eq(syncKnowledge.deleted, false),
          isNull(syncKnowledge.deletedAt),
          knowledgeIds.length > 1
            ? inArray(syncKnowledge.id, knowledgeIds)
            : or(eq(syncKnowledge.id, args.knowledge!), eq(syncKnowledge.front, args.knowledge!)),
        ))
        .limit(knowledgeIds.length > 1 ? knowledgeIds.length : 2);
      if (knowledgeRows.length === 0) throw new Error(`No active knowledge matches: ${args.knowledge}`);
      if (knowledgeIds.length === 1 && knowledgeRows.length > 1) {
        throw new Error(`More than one knowledge record matches ${args.knowledge}; use its ID.`);
      }
      if (knowledgeIds.length > 1 && knowledgeRows.length !== new Set(knowledgeIds).size) {
        throw new Error("One or more knowledge IDs were missing or inactive; no cards were added.");
      }
      const existing = await db
        .select({ id: syncCards.id, knowledgeId: syncCards.knowledgeId })
        .from(syncCards)
        .where(and(
          eq(syncCards.ownerId, owner),
          eq(syncCards.deckId, deckId!),
          inArray(syncCards.knowledgeId, knowledgeRows.map((item) => item.id)),
          isNull(syncCards.deletedAt),
        ));
      const existingKnowledgeIds = new Set(existing.map((item) => item.knowledgeId));
      const additions = knowledgeRows.filter((item) => !existingKnowledgeIds.has(item.id));
      if (additions.length === 0) throw new Error("All requested cards already exist in that deck.");
      const now = new Date();
      const values = additions.map((knowledge) => ({
        ownerId: owner,
        id: randomUUID(),
        deckId: deckId!,
        knowledgeId: knowledge.id,
        createdAt: now,
        updatedAt: now,
        serverUpdatedAt: now,
      }));
      await db.insert(syncCards).values(values);
      console.log(`Added ${values.length} card${values.length === 1 ? "" : "s"}; skipped ${existing.length} already present.`);
      return;
    }

    const matches = await db
      .select({ id: syncCards.id, front: syncKnowledge.front })
      .from(syncCards)
      .innerJoin(syncKnowledge, and(eq(syncKnowledge.ownerId, syncCards.ownerId), eq(syncKnowledge.id, syncCards.knowledgeId)))
      .where(and(
        eq(syncCards.ownerId, owner),
        isNull(syncCards.deletedAt),
        or(eq(syncCards.id, args.target!), eq(syncKnowledge.front, args.target!)),
      ))
      .limit(2);
    if (matches.length === 0) throw new Error(`No active card matches: ${args.target}`);
    if (matches.length > 1) throw new Error(`More than one card matches ${args.target}; use its card ID.`);
    const card = matches[0];

    if (args.cardCommand === "show") {
      const [row] = await db.execute(sql`
        select row_to_json(card) as card, row_to_json(deck) as deck, row_to_json(knowledge) as knowledge
        from sync_cards card
        join sync_decks deck on deck.owner_id = card.owner_id and deck.id = card.deck_id
        join sync_knowledge knowledge on knowledge.owner_id = card.owner_id and knowledge.id = card.knowledge_id
        where card.owner_id = ${owner} and card.id = ${card.id}
        limit 1
      `);
      console.log(JSON.stringify(row, null, 2));
      return;
    }

    const now = new Date();
    await db
      .update(syncCards)
      .set({ deletedAt: now, updatedAt: now, serverUpdatedAt: now })
      .where(and(eq(syncCards.ownerId, owner), eq(syncCards.id, card.id)));
    console.log(`Removed ${card.front} (${card.id}) from its deck; knowledge retained.`);
    return;
  }

  if (args.command === "list") {
    const rows = await db
      .select({
        id: syncDecks.id,
        name: syncDecks.name,
        language: syncDecks.languageId,
        paused: syncDecks.newCardsPaused,
        starred: syncDecks.isStarred,
        deletedAt: syncDecks.deletedAt,
      })
      .from(syncDecks)
      .where(and(eq(syncDecks.ownerId, owner), args.all ? undefined : isNull(syncDecks.deletedAt)))
      .orderBy(syncDecks.name);
    console.table(rows);
    return;
  }

  if (args.command === "create") {
    let language = args.language;
    if (!language) {
      const languages = await db
        .selectDistinct({ id: syncDecks.languageId })
        .from(syncDecks)
        .where(and(eq(syncDecks.ownerId, owner), isNull(syncDecks.deletedAt), isNotNull(syncDecks.languageId)))
        .limit(2);
      if (languages.length !== 1 || !languages[0].id) {
        throw new Error("Pass --language LANGUAGE_ID because it cannot be inferred.");
      }
      language = languages[0].id;
    }
    const now = new Date();
    const id = randomUUID();
    await db.insert(syncDecks).values({
      ownerId: owner,
      id,
      name: args.name!.trim(),
      languageId: language,
      createdAt: now,
      updatedAt: now,
      serverUpdatedAt: now,
    });
    console.log(`Created ${args.name} (${id}).`);
    return;
  }

  const matches = await db
    .select({ id: syncDecks.id, name: syncDecks.name, primaryDeckId: syncDecks.primaryDeckId })
    .from(syncDecks)
    .where(and(
      eq(syncDecks.ownerId, owner),
      isNull(syncDecks.deletedAt),
      or(eq(syncDecks.id, args.target!), eq(syncDecks.name, args.target!)),
    ))
    .limit(2);
  if (matches.length === 0) throw new Error(`No active deck matches: ${args.target}`);
  if (matches.length > 1) throw new Error(`More than one deck is named ${args.target}; use its ID.`);
  const deck = matches[0];
  const now = new Date();

  if (args.command === "edit") {
    await db
      .update(syncDecks)
      .set({
        ...(args.name !== undefined ? { name: args.name.trim() } : {}),
        ...(args.paused !== undefined ? { newCardsPaused: args.paused } : {}),
        ...(args.starred !== undefined ? { isStarred: args.starred } : {}),
        updatedAt: now,
        serverUpdatedAt: now,
      })
      .where(and(eq(syncDecks.ownerId, owner), eq(syncDecks.id, deck.id)));
    console.log(`Updated ${deck.name} (${deck.id}).`);
    return;
  }

  await db.transaction(async (tx) => {
    let deckIds = [deck.id];
    if (!deck.primaryDeckId) {
      const links = await tx
        .select({ id: syncDeckLinks.linkedDeckId })
        .from(syncDeckLinks)
        .where(and(eq(syncDeckLinks.ownerId, owner), eq(syncDeckLinks.primaryDeckId, deck.id)));
      deckIds = [deck.id, ...links.map((link) => link.id)];
    }
    await tx
      .update(syncDecks)
      .set({ deletedAt: now, updatedAt: now, serverUpdatedAt: now })
      .where(and(eq(syncDecks.ownerId, owner), inArray(syncDecks.id, deckIds)));
    await tx
      .update(syncCards)
      .set({ deletedAt: now, updatedAt: now, serverUpdatedAt: now })
      .where(and(eq(syncCards.ownerId, owner), inArray(syncCards.deckId, deckIds), isNull(syncCards.deletedAt)));
  });
  console.log(`Moved ${deck.name} to Trash.`);
};

if (import.meta.main) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Deck command failed.");
    process.exitCode = 1;
  });
}
