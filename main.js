import {
  compareHands,
  createDeck,
  dealCards,
  evaluateBestHand,
  formatCard,
  isRedSuit,
  shuffleDeck,
} from "./poker.js";
import { decideAIAction } from "./ai.js";

const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const DEFAULT_BET = 50;
const DEFAULT_RAISE = 100;
const MAX_RAISES_PER_ROUND = 2;

const STAGE_LABELS = {
  idle: "Idle",
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

const gameState = {
  deck: [],
  playerCards: [],
  aiCards: [],
  communityCards: [],
  playerChips: STARTING_CHIPS,
  aiChips: STARTING_CHIPS,
  pot: 0,
  currentBet: 0,
  playerCurrentBet: 0,
  aiCurrentBet: 0,
  stage: "idle",
  handOver: true,
  message: "按 New Hand 開始遊戲。",
  messages: ["按 New Hand 開始遊戲。"],
  raiseCount: 0,
  showdownRevealed: false,
};

const elements = {};

document.addEventListener("DOMContentLoaded", initGame);

function initGame() {
  elements.playerChips = document.querySelector("#player-chips");
  elements.aiChips = document.querySelector("#ai-chips");
  elements.pot = document.querySelector("#pot");
  elements.stage = document.querySelector("#stage");
  elements.currentBet = document.querySelector("#current-bet");
  elements.toCall = document.querySelector("#to-call");
  elements.aiCards = document.querySelector("#ai-cards");
  elements.communityCards = document.querySelector("#community-cards");
  elements.playerCards = document.querySelector("#player-cards");
  elements.messageLog = document.querySelector("#message-log");
  elements.amountInput = document.querySelector("#bet-amount");
  elements.checkButton = document.querySelector("#check-button");
  elements.callButton = document.querySelector("#call-button");
  elements.betButton = document.querySelector("#bet-button");
  elements.raiseButton = document.querySelector("#raise-button");
  elements.foldButton = document.querySelector("#fold-button");
  elements.newHandButton = document.querySelector("#new-hand-button");

  elements.checkButton.addEventListener("click", () => handlePlayerAction("check"));
  elements.callButton.addEventListener("click", () => handlePlayerAction("call"));
  elements.betButton.addEventListener("click", () => handlePlayerAction("bet"));
  elements.raiseButton.addEventListener("click", () => handlePlayerAction("raise"));
  elements.foldButton.addEventListener("click", () => handlePlayerAction("fold"));
  elements.newHandButton.addEventListener("click", startNewHand);
  elements.amountInput.addEventListener("change", normalizeAmountInput);

  renderGame();
}

function startNewHand() {
  if (gameState.playerChips <= 0 || gameState.aiChips <= 0) {
    gameState.playerChips = STARTING_CHIPS;
    gameState.aiChips = STARTING_CHIPS;
    gameState.messages = ["有玩家籌碼歸零，籌碼重置為 1000。"];
  } else {
    gameState.messages = [];
  }

  Object.assign(gameState, {
    deck: shuffleDeck(createDeck()),
    playerCards: [],
    aiCards: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    playerCurrentBet: 0,
    aiCurrentBet: 0,
    stage: "preflop",
    handOver: false,
    raiseCount: 0,
    showdownRevealed: false,
  });

  postBlind("player", SMALL_BLIND);
  postBlind("ai", BIG_BLIND);
  gameState.currentBet = Math.max(gameState.playerCurrentBet, gameState.aiCurrentBet);
  gameState.playerCards = dealCards(gameState.deck, 2);
  gameState.aiCards = dealCards(gameState.deck, 2);

  addMessage(`新局開始：玩家小盲 ${SMALL_BLIND}，AI 大盲 ${BIG_BLIND}。`);
  addMessage(`玩家需跟注 ${getToCall("player")}。`);

  if (gameState.playerChips === 0 || gameState.aiChips === 0) {
    runAllInToShowdown();
    return;
  }

  renderGame();
}

function handlePlayerAction(action) {
  if (gameState.handOver) return;

  const toCall = getToCall("player");

  if (action === "fold") {
    addMessage("玩家棄牌。");
    awardPot("ai", "AI 因玩家棄牌獲勝。");
    return;
  }

  if (action === "check") {
    if (toCall > 0) {
      addMessage(`目前需要跟注 ${toCall}，不能 Check。`);
      renderGame();
      return;
    }

    addMessage("玩家 Check。");
    processAIAction();
    return;
  }

  if (action === "call") {
    if (toCall <= 0) {
      addMessage("目前不需要跟注，可以 Check。");
      renderGame();
      return;
    }

    const paid = commitChips("player", toCall);
    addMessage(`玩家跟注 ${paid}${paid < toCall ? "，All-in" : ""}。`);
    continueAfterBetsSettled(paid < toCall);
    return;
  }

  if (action === "bet") {
    if (toCall > 0) {
      addMessage("對手已下注，請選擇 Call、Raise 或 Fold。");
      renderGame();
      return;
    }

    const amount = getPlayerBetAmount(gameState.playerChips);
    if (amount <= 0) return;

    const paid = commitChips("player", amount);
    gameState.currentBet = gameState.playerCurrentBet;
    addMessage(`玩家下注 ${paid}${gameState.playerChips === 0 ? "，All-in" : ""}。`);
    processAIAction();
    return;
  }

  if (action === "raise") {
    if (toCall <= 0) {
      addMessage("目前沒有人下注，請使用 Bet。");
      renderGame();
      return;
    }

    if (gameState.raiseCount >= MAX_RAISES_PER_ROUND) {
      addMessage("本輪加注次數已達上限。");
      renderGame();
      return;
    }

    if (gameState.aiChips <= 0) {
      addMessage("AI 已 All-in，不能再加注。");
      renderGame();
      return;
    }

    const raiseBy = getPlayerBetAmount(Math.max(0, gameState.playerChips - toCall));
    if (raiseBy <= 0) {
      addMessage("籌碼不足，無法加注。");
      renderGame();
      return;
    }

    const paid = commitChips("player", toCall + raiseBy);
    gameState.currentBet = gameState.playerCurrentBet;
    gameState.raiseCount += 1;
    addMessage(`玩家加注到 ${gameState.currentBet}${gameState.playerChips === 0 ? "，All-in" : ""}。`);
    processAIAction(paid < toCall + raiseBy);
  }
}

function processAIAction(playerAllInShort = false) {
  if (gameState.handOver) return;

  if (playerAllInShort) {
    runAllInToShowdown();
    return;
  }

  const decision = sanitizeAIAction(decideAIAction({
    ...gameState,
    defaultBet: DEFAULT_BET,
    raiseAmount: DEFAULT_RAISE,
    maxRaises: MAX_RAISES_PER_ROUND,
  }));

  if (decision.action === "fold") {
    addMessage("AI 棄牌。");
    awardPot("player", "玩家因 AI 棄牌獲勝。");
    return;
  }

  if (decision.action === "check") {
    addMessage("AI Check。");
    advanceStage();
    return;
  }

  if (decision.action === "call") {
    const toCall = getToCall("ai");
    const paid = commitChips("ai", toCall);
    addMessage(`AI 跟注 ${paid}${paid < toCall ? "，All-in" : ""}。`);
    continueAfterBetsSettled(paid < toCall);
    return;
  }

  if (decision.action === "bet") {
    const paid = commitChips("ai", decision.amount);
    gameState.currentBet = gameState.aiCurrentBet;
    addMessage(`AI 下注 ${paid}${gameState.aiChips === 0 ? "，All-in" : ""}。`);
    renderGame();
    return;
  }

  if (decision.action === "raise") {
    const toCall = getToCall("ai");
    const paid = commitChips("ai", decision.amount);

    if (paid <= toCall) {
      addMessage(`AI 跟注 ${paid}${paid < toCall ? "，All-in" : ""}。`);
      continueAfterBetsSettled(paid < toCall);
      return;
    }

    gameState.currentBet = gameState.aiCurrentBet;
    gameState.raiseCount += 1;
    addMessage(`AI 加注到 ${gameState.currentBet}${gameState.aiChips === 0 ? "，All-in" : ""}。`);
    renderGame();
  }
}

function sanitizeAIAction(decision) {
  const toCall = getToCall("ai");

  if (toCall > 0 && decision.action === "check") {
    return { ...decision, action: "call", amount: Math.min(gameState.aiChips, toCall) };
  }

  if (toCall === 0 && decision.action === "call") {
    return { ...decision, action: "check", amount: 0 };
  }

  if (decision.action === "raise" && (gameState.raiseCount >= MAX_RAISES_PER_ROUND || gameState.aiChips <= toCall)) {
    return { ...decision, action: "call", amount: Math.min(gameState.aiChips, toCall) };
  }

  if (decision.action === "raise" && gameState.playerChips <= 0) {
    return { ...decision, action: "call", amount: Math.min(gameState.aiChips, toCall) };
  }

  if (decision.action === "bet" && toCall > 0) {
    return { ...decision, action: "call", amount: Math.min(gameState.aiChips, toCall) };
  }

  return decision;
}

function continueAfterBetsSettled(wasShortCall = false) {
  if (wasShortCall || gameState.playerChips === 0 || gameState.aiChips === 0) {
    runAllInToShowdown();
    return;
  }

  advanceStage();
}

function advanceStage() {
  if (gameState.handOver) return;

  if (gameState.stage === "river") {
    showdown();
    return;
  }

  resetRoundBets();

  if (gameState.stage === "preflop") {
    gameState.communityCards.push(...dealCards(gameState.deck, 3));
    gameState.stage = "flop";
    addMessage("發出 Flop。");
  } else if (gameState.stage === "flop") {
    gameState.communityCards.push(...dealCards(gameState.deck, 1));
    gameState.stage = "turn";
    addMessage("發出 Turn。");
  } else if (gameState.stage === "turn") {
    gameState.communityCards.push(...dealCards(gameState.deck, 1));
    gameState.stage = "river";
    addMessage("發出 River。");
  }

  renderGame();
}

function runAllInToShowdown() {
  refundUncalledBet();
  addMessage("有玩家 All-in，直接發完公共牌並攤牌。");

  if (gameState.communityCards.length === 0) {
    gameState.communityCards.push(...dealCards(gameState.deck, 3));
    addMessage("發出 Flop。");
  }

  while (gameState.communityCards.length < 5) {
    gameState.communityCards.push(...dealCards(gameState.deck, 1));
    addMessage(gameState.communityCards.length === 4 ? "發出 Turn。" : "發出 River。");
  }

  showdown();
}

function showdown() {
  if (gameState.handOver) return;

  refundUncalledBet();
  gameState.stage = "showdown";
  gameState.showdownRevealed = true;

  const playerHand = evaluateBestHand([...gameState.playerCards, ...gameState.communityCards]);
  const aiHand = evaluateBestHand([...gameState.aiCards, ...gameState.communityCards]);
  const result = compareHands(playerHand, aiHand);

  addMessage(`玩家牌型：${playerHand.name}。AI 牌型：${aiHand.name}。`);

  if (result > 0) {
    awardPot("player", `玩家以 ${playerHand.name} 獲勝。`);
  } else if (result < 0) {
    awardPot("ai", `AI 以 ${aiHand.name} 獲勝。`);
  } else {
    awardPot("split", `雙方同為 ${playerHand.name}，平分底池。`);
  }
}

function awardPot(winner, message) {
  if (winner === "player") {
    gameState.playerChips += gameState.pot;
  } else if (winner === "ai") {
    gameState.aiChips += gameState.pot;
  } else {
    const playerShare = Math.floor(gameState.pot / 2);
    gameState.playerChips += playerShare;
    gameState.aiChips += gameState.pot - playerShare;
  }

  gameState.pot = 0;
  gameState.currentBet = 0;
  gameState.playerCurrentBet = 0;
  gameState.aiCurrentBet = 0;
  gameState.handOver = true;
  addMessage(message);
  renderGame();
}

function postBlind(actor, amount) {
  const paid = commitChips(actor, amount);
  if (paid < amount) {
    addMessage(`${actor === "player" ? "玩家" : "AI"} 盲注 All-in ${paid}。`);
  }
}

function commitChips(actor, amount) {
  const chipsKey = actor === "player" ? "playerChips" : "aiChips";
  const betKey = actor === "player" ? "playerCurrentBet" : "aiCurrentBet";
  const paid = Math.max(0, Math.min(gameState[chipsKey], Math.round(amount)));

  gameState[chipsKey] -= paid;
  gameState[betKey] += paid;
  gameState.pot += paid;

  return paid;
}

function refundUncalledBet() {
  const difference = Math.abs(gameState.playerCurrentBet - gameState.aiCurrentBet);
  if (difference === 0) return;

  if (gameState.playerCurrentBet > gameState.aiCurrentBet) {
    gameState.playerCurrentBet -= difference;
    gameState.playerChips += difference;
    gameState.pot -= difference;
    addMessage(`退還玩家未被跟注的 ${difference}。`);
  } else {
    gameState.aiCurrentBet -= difference;
    gameState.aiChips += difference;
    gameState.pot -= difference;
    addMessage(`退還 AI 未被跟注的 ${difference}。`);
  }

  gameState.currentBet = Math.min(gameState.playerCurrentBet, gameState.aiCurrentBet);
}

function resetRoundBets() {
  gameState.currentBet = 0;
  gameState.playerCurrentBet = 0;
  gameState.aiCurrentBet = 0;
  gameState.raiseCount = 0;
}

function getToCall(actor) {
  const current = actor === "player" ? gameState.playerCurrentBet : gameState.aiCurrentBet;
  return Math.max(0, gameState.currentBet - current);
}

function getPlayerBetAmount(maxAmount) {
  const amount = Number(elements.amountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    addMessage("請輸入大於 0 的下注金額。");
    renderGame();
    return 0;
  }

  if (maxAmount <= 0) {
    addMessage("籌碼不足，無法下注。");
    renderGame();
    return 0;
  }

  return Math.min(Math.round(amount), maxAmount);
}

function normalizeAmountInput() {
  const max = Math.max(1, gameState.playerChips);
  const value = Number(elements.amountInput.value);
  if (!Number.isFinite(value) || value < 1) {
    elements.amountInput.value = DEFAULT_BET;
    return;
  }
  elements.amountInput.value = Math.min(Math.round(value), max);
}

function addMessage(message) {
  gameState.message = message;
  gameState.messages.unshift(message);
  gameState.messages = gameState.messages.slice(0, 8);
}

function renderGame() {
  const playerToCall = getToCall("player");
  const activeHand = !gameState.handOver && gameState.stage !== "idle";

  elements.playerChips.textContent = gameState.playerChips;
  elements.aiChips.textContent = gameState.aiChips;
  elements.pot.textContent = gameState.pot;
  elements.stage.textContent = STAGE_LABELS[gameState.stage] ?? gameState.stage;
  elements.currentBet.textContent = gameState.currentBet;
  elements.toCall.textContent = playerToCall;

  renderCardRow(elements.aiCards, gameState.aiCards, !gameState.showdownRevealed && activeHand);
  renderCardRow(elements.communityCards, gameState.communityCards, false, 5);
  renderCardRow(elements.playerCards, gameState.playerCards, false);

  elements.messageLog.innerHTML = gameState.messages
    .map((message) => `<li>${escapeHtml(message)}</li>`)
    .join("");

  elements.amountInput.max = Math.max(1, gameState.playerChips);
  elements.amountInput.disabled = !activeHand || gameState.playerChips <= 0;

  elements.checkButton.disabled = !activeHand || playerToCall > 0;
  elements.callButton.disabled = !activeHand || playerToCall <= 0 || gameState.playerChips <= 0;
  elements.betButton.disabled = !activeHand || playerToCall > 0 || gameState.playerChips <= 0;
  elements.raiseButton.disabled =
    !activeHand ||
    playerToCall <= 0 ||
    gameState.playerChips <= playerToCall ||
    gameState.aiChips <= 0 ||
    gameState.raiseCount >= MAX_RAISES_PER_ROUND;
  elements.foldButton.disabled = !activeHand;
  elements.newHandButton.disabled = activeHand;
  elements.callButton.textContent = playerToCall > 0 ? `Call ${Math.min(playerToCall, gameState.playerChips)}` : "Call";
}

function renderCardRow(container, cards, hidden = false, slots = cards.length) {
  container.innerHTML = "";

  for (let index = 0; index < slots; index += 1) {
    const card = cards[index];
    const cardElement = document.createElement("div");
    cardElement.className = "card";

    if (!card) {
      cardElement.classList.add("empty");
      cardElement.textContent = "·";
    } else if (hidden) {
      cardElement.classList.add("hidden-card");
      cardElement.textContent = "?";
    } else {
      cardElement.classList.add(isRedSuit(card.suit) ? "red" : "black");
      cardElement.innerHTML = `
        <span class="card-rank">${escapeHtml(card.rank)}</span>
        <span class="card-suit">${formatCard(card).slice(card.rank.length)}</span>
      `;
      cardElement.title = formatCard(card);
    }

    container.appendChild(cardElement);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
