import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { useState, useEffect, useMemo, useCallback } from "react";
import logoUrl from "../logo.png";
import { claimMining } from "./api/-mining";
import { getBalance } from "./api/-balance";
import { requestWithdrawal } from "./api/-withdraw";

// Read the business name at request time
const getBusinessName = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const cfg = JSON.parse(await readFile("site.json", "utf8")) as {
      businessName?: string;
    };
    return cfg.businessName?.trim() ?? "HashHustle";
  } catch {
    return "HashHustle";
  }
});

export const Route = createFileRoute("/")({
  loader: () => getBusinessName(),
  component: Dashboard,
});

function Dashboard() {
  const businessName = Route.useLoaderData();

  // Core App State
  const [balanceSats, setBalanceSats] = useState<number>(0);
  const [isMining, setIsMining] = useState<boolean>(false);
  const [activeTier, setActiveTier] = useState<"free" | "pro" | "whale">("free");
  const [loading, setLoading] = useState<boolean>(true);

  // Load initial balance from backend
  useEffect(() => {
    getBalance().then((data) => {
      setBalanceSats(data.sats);
      setActiveTier(data.tier);
      setLoading(false);
    }).catch(() => {
      // Fallback to defaults if backend unreachable
      setBalanceSats(8420);
      setLoading(false);
    });
  }, []);
  
  // Streak State
  const [streakDay, setStreakDay] = useState<number>(3);
  const [streakClaimed, setStreakClaimed] = useState<boolean>(false);
  const [streakMessage, setStreakMessage] = useState<string>("");

  // Missions State
  const [completedMissions, setCompletedMissions] = useState<string[]>([]);
  
  // Ad Modal State
  const [adModalOpen, setAdModalOpen] = useState<boolean>(false);
  const [adCountdown, setAdCountdown] = useState<number>(5);
  const [activeAdReward, setActiveAdReward] = useState<number>(0);
  const [activeAdTitle, setActiveAdTitle] = useState<string>("");
  const [adWatchFinished, setAdWatchFinished] = useState<boolean>(false);

  // Subscription Modal State
  const [subModalOpen, setSubModalOpen] = useState<boolean>(false);
  const [subModalTier, setSubModalTier] = useState<"pro" | "whale" | null>(null);
  const [subscribingState, setSubscribingState] = useState<"idle" | "authenticating" | "success">("idle");

  // Withdrawal State
  const [withdrawAddress, setWithdrawAddress] = useState<string>("");
  const [withdrawalSuccess, setWithdrawalSuccess] = useState<boolean>(false);
  const [withdrawalTxId, setWithdrawalTxId] = useState<string>("");
  const [withdrawError, setWithdrawError] = useState<string>("");
  const [isWithdrawing, setIsWithdrawing] = useState<boolean>(false);

  // Active Mining Ticker
  useEffect(() => {
    let interval: Timer | null = null;
    if (isMining) {
      // Free hashrate: 5 TH/s -> 0.1 Sats/sec
      // Pro hashrate: 25 TH/s -> 0.5 Sats/sec
      // Whale hashrate: 100 TH/s -> 2.0 Sats/sec
      const incrementPerSec = activeTier === "whale" ? 2.0 : activeTier === "pro" ? 0.5 : 0.1;
      
      interval = setInterval(() => {
        setBalanceSats((prev) => parseFloat((prev + incrementPerSec).toFixed(2)));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isMining, activeTier]);

  // Derived stats
  const activeHashrate = useMemo(() => {
    if (!isMining) return 0;
    if (activeTier === "whale") return 100.0;
    if (activeTier === "pro") return 25.0;
    return 5.0;
  }, [isMining, activeTier]);

  const withdrawalFeeRate = useMemo(() => {
    if (activeTier === "whale") return 0.0; // 0%
    if (activeTier === "pro") return 0.005; // 0.5%
    return 0.015; // 1.5%
  }, [activeTier]);

  const currentWithdrawFee = useMemo(() => {
    return Math.round(balanceSats * withdrawalFeeRate);
  }, [balanceSats, withdrawalFeeRate]);

  // Handle Streak Claim
  const handleClaimStreak = () => {
    if (streakClaimed) return;
    const bonus = 150;
    setBalanceSats((prev) => prev + bonus);
    setStreakClaimed(true);
    setStreakDay(4);
    setStreakMessage(`🎉 Stacking Streak Bonus Claimed! +${bonus} Sats added to your balance.`);
    setTimeout(() => setStreakMessage(""), 4000);
  };

  // Handle Video Ad Click
  const startAdMission = (missionId: string, title: string, reward: number) => {
    if (completedMissions.includes(missionId)) return;
    setActiveAdTitle(title);
    setActiveAdReward(reward);
    setAdModalOpen(true);
    setAdCountdown(5);
    setAdWatchFinished(false);
  };

  // Countdown timer for ad
  useEffect(() => {
    let timer: Timer | null = null;
    if (adModalOpen && adCountdown > 0) {
      timer = setInterval(() => {
        setAdCountdown((prev) => prev - 1);
      }, 1000);
    } else if (adModalOpen && adCountdown === 0) {
      setAdWatchFinished(true);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [adModalOpen, adCountdown]);

  // Claim Ad Reward
  const claimAdReward = () => {
    setBalanceSats((prev) => prev + activeAdReward);
    const missionKey = activeAdTitle.toLowerCase().replace(/\s+/g, "-");
    setCompletedMissions((prev) => [...prev, missionKey]);
    setAdModalOpen(false);
    
    // Add custom toast indicator
    setStreakMessage(`⚡ Mission Completed: +${activeAdReward} Sats added!`);
    setTimeout(() => setStreakMessage(""), 4000);
  };

  // Handle Subscription Upgrades
  const openUpgradeModal = (tier: "pro" | "whale") => {
    setSubModalTier(tier);
    setSubModalOpen(true);
    setSubscribingState("idle");
  };

  const processMockPurchase = () => {
    setSubscribingState("authenticating");
    setTimeout(() => {
      setSubscribingState("success");
      setTimeout(() => {
        if (subModalTier) {
          setActiveTier(subModalTier);
        }
        setSubModalOpen(false);
        setStreakMessage(`💎 Welcome to ${subModalTier?.toUpperCase()} Tier! Your mining engine is boosted.`);
        setTimeout(() => setStreakMessage(""), 4000);
      }, 1500);
    }, 2000);
  };

  // Handle Mining Toggle — calls backend API
  const handleMiningToggle = useCallback(async () => {
    if (isMining) {
      setIsMining(false);
    } else {
      try {
        const result = await claimMining();
        setBalanceSats((prev) => prev + result.reward);
        setIsMining(true);
        setStreakMessage(`⛏️ +${result.reward} Sats mined! Hashrate: ${result.hashrate} TH/s`);
        setTimeout(() => setStreakMessage(""), 4000);
      } catch {
        // Fallback: toggle locally if backend unreachable
        setIsMining(true);
      }
    }
  }, [isMining]);

  // Handle Withdrawal — calls backend API
  const handleWithdrawal = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (balanceSats < 10000) {
      setWithdrawError("Minimum withdrawal threshold is 10,000 Satoshis.");
      return;
    }
    if (!withdrawAddress.trim() || withdrawAddress.length < 26) {
      setWithdrawError("Please enter a valid Bitcoin wallet address.");
      return;
    }

    setWithdrawError("");
    setIsWithdrawing(true);

    try {
      const result = await requestWithdrawal({
        data: { address: withdrawAddress, amount: balanceSats },
      });

      if (result.success) {
        setWithdrawalTxId(result.txId);
        setBalanceSats(0);
        setWithdrawalSuccess(true);
      } else {
        setWithdrawError(result.error || "Withdrawal failed");
      }
    } catch {
      setWithdrawError("Network error — please try again");
    } finally {
      setIsWithdrawing(false);
    }
  }, [balanceSats, withdrawAddress]);

  const resetWithdrawalScreen = () => {
    setWithdrawAddress("");
    setWithdrawalSuccess(false);
    setWithdrawalTxId("");
  };

  return (
    <main className="min-h-dvh bg-hh-dark text-[#FFFFFF] font-sans antialiased selection:bg-[#F7931A] selection:text-black">
      {/* Dynamic Toast System */}
      {streakMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[#F7931A] text-black px-6 py-4 rounded-xl font-bold shadow-2xl flex items-center gap-3 border border-[#FFFFFF]/20 animate-bounce">
          <span>{streakMessage}</span>
        </div>
      )}

      {/* Top Fintech Navigation Header */}
      <header className="border-b border-[#2D2D2D] bg-[#1A1A1A] sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Bitcoin Logo Emblem */}
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#1A1A1A] flex items-center justify-center shadow-[0_0_15px_rgba(247,147,26,0.3)] border border-[#FFFFFF]/10">
              <img src={logoUrl} alt="HashHustle Logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <span className="text-xl font-black tracking-tight bg-gradient-to-r from-white via-white to-[#F7931A] bg-clip-text text-transparent">
                {businessName || "HashHustle"}
              </span>
              <div className="text-[10px] text-[#BDBDBD] tracking-wider uppercase font-bold">Fintech Mining Network</div>
            </div>
          </div>

          {/* Network Stats Ticker */}
          <div className="hidden md:flex items-center gap-6 text-xs text-[#BDBDBD] border-l border-[#2D2D2D] pl-6">
            <div>
              <span className="text-[#27AE60] font-bold">● Network Online</span>
              <div className="font-semibold text-white">Difficulty: 84.38 T</div>
            </div>
            <div>
              <span className="text-[#BDBDBD]">Global Hashrate</span>
              <div className="font-semibold text-white">658.2 EH/s</div>
            </div>
            <div>
              <span className="text-[#BDBDBD]">Active Hustlers</span>
              <div className="font-semibold text-[#F7931A] animate-pulse">48,291 Online</div>
            </div>
          </div>

          {/* Current User Balance Card */}
          <div className="bg-[#2D2D2D] border border-[#3A3A3A] hover:border-[#F7931A]/30 transition-all rounded-xl p-2.5 px-4 flex items-center gap-3 shadow-inner">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#BDBDBD]">Stacking Balance</div>
              <div className="font-mono font-bold text-lg text-[#F7931A] tracking-tight flex items-center justify-end gap-1.5">
                <span className="animate-pulse w-2 h-2 rounded-full bg-[#27AE60]"></span>
                {balanceSats.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-xs text-white">Sats</span>
              </div>
              <div className="text-[10px] text-[#BDBDBD] font-mono">
                {(balanceSats / 100000000).toFixed(8)} BTC
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* COLUMN 1: THE GAMIFIED MINING HARVESTER */}
          <section className="bg-[#1A1A1A] border border-[#2D2D2D] rounded-3xl p-6 flex flex-col justify-between shadow-xl relative overflow-hidden group">
            {/* Card Accent Lines */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#F7931A] to-transparent opacity-50"></div>
            
            <div>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-lg font-black tracking-wide uppercase">Harvester Engine</h2>
                  <p className="text-xs text-[#BDBDBD]">Real-time Satoshi Generator</p>
                </div>
                <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase border ${
                  isMining 
                    ? "bg-[#27AE60]/10 text-[#27AE60] border-[#27AE60]/30 animate-pulse" 
                    : "bg-[#EB5757]/10 text-[#EB5757] border-[#EB5757]/30"
                }`}>
                  {isMining ? "Active & Mining" : "Harvester Idle"}
                </span>
              </div>

              {/* High-Fidelity Circular Progress Indicator */}
              <div className="my-8 flex justify-center">
                <div className="relative w-64 h-64 flex items-center justify-center">
                  
                  {/* Glowing Pulse Rings */}
                  {isMining && (
                    <>
                      <div className="absolute inset-0 rounded-full border-2 border-[#F7931A]/30 animate-ping opacity-75"></div>
                      <div className="absolute -inset-4 rounded-full border border-[#F7931A]/10 animate-pulse opacity-40"></div>
                    </>
                  )}
                  
                  {/* Outer Orbit Track */}
                  <div className="absolute inset-2 rounded-full border-[8px] border-[#222222]"></div>
                  
                  {/* Simulated Segmented LED Progress Bar */}
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      stroke="#222222"
                      strokeWidth="6"
                      fill="transparent"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      stroke="#F7931A"
                      strokeWidth="6"
                      fill="transparent"
                      strokeDasharray={2 * Math.PI * 42}
                      strokeDashoffset={2 * Math.PI * 42 * (isMining ? 0.35 : 1)}
                      className="transition-all duration-1000 ease-in-out"
                    />
                  </svg>

                  {/* Ring Core Stats */}
                  <div className="absolute inset-6 bg-[#131313] rounded-full flex flex-col items-center justify-center border-4 border-[#222222] shadow-2xl">
                    <span className="text-[10px] tracking-widest font-black uppercase text-[#BDBDBD]">Current Speed</span>
                    <span className="text-3xl font-black font-mono text-white my-1 tracking-tight">
                      {activeHashrate.toFixed(1)} <span className="text-sm text-[#F7931A]">TH/s</span>
                    </span>
                    <div className="text-[10px] bg-[#2D2D2D] border border-[#3A3A3A] text-[#BDBDBD] px-2.5 py-1 rounded-md font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${isMining ? "bg-[#27AE60] animate-ping" : "bg-[#EB5757]"}`}></span>
                      {activeTier.toUpperCase()} HASH
                    </div>
                  </div>
                </div>
              </div>

              {/* Dynamic Stats Panel */}
              <div className="grid grid-cols-2 gap-4 bg-[#131313] border border-[#2D2D2D] rounded-2xl p-4 mb-6 font-mono text-xs">
                <div>
                  <div className="text-[#BDBDBD] text-[9px] uppercase font-bold">EST. 24H PAYOUT</div>
                  <div className="text-white font-bold mt-1 text-sm">
                    {isMining ? (activeHashrate * 172.8).toFixed(0) : "0"} Sats
                  </div>
                </div>
                <div>
                  <div className="text-[#BDBDBD] text-[9px] uppercase font-bold">ACTIVE PROTOCOL</div>
                  <div className="text-[#F7931A] font-bold mt-1 text-sm">SHA-256 (ASIC)</div>
                </div>
                <div className="col-span-2 pt-2 border-t border-[#222222] flex justify-between items-center text-[10px]">
                  <span className="text-[#BDBDBD]">Hardware Server Pool</span>
                  <span className="text-white font-semibold">hh-us-west-04.pool</span>
                </div>
              </div>
            </div>

            {/* Giant Harvester Power Button */}
            <button
              onClick={handleMiningToggle}
              className={`w-full py-5 rounded-2xl font-black uppercase text-base tracking-wider transition-all duration-300 transform active:scale-95 shadow-lg flex items-center justify-center gap-3 ${
                isMining
                  ? "bg-[#27AE60] text-black hover:bg-[#2ecc71] shadow-[0_0_20px_rgba(39,174,96,0.3)]"
                  : "bg-[#F7931A] text-black hover:bg-[#ffaa3a] shadow-[0_0_20px_rgba(247,147,26,0.3)]"
              }`}
            >
              <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                {isMining ? (
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                ) : (
                  <path d="M8 5v14l11-7z" />
                )}
              </svg>
              {isMining ? "HALT HARVESTER ENGINE" : "ENGAGE MINING ENGINE"}
            </button>
          </section>

          {/* COLUMN 2: DAILY MISSION BOARD & STACKING BONUS */}
          <section className="space-y-6">
            
            {/* DAILY STREAK STACKING TRACKER */}
            <div className="bg-[#1A1A1A] border border-[#2D2D2D] rounded-3xl p-6 shadow-xl relative overflow-hidden">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-md font-black uppercase tracking-wide">Stacking Multiplier</h3>
                  <p className="text-xs text-[#BDBDBD]">Check-in daily to stack bonuses</p>
                </div>
                <span className="text-xs bg-[#F7931A]/10 text-[#F7931A] px-2 py-0.5 rounded-md font-bold uppercase">
                  Streak Active
                </span>
              </div>

              {/* Streak Tracker Visual Row */}
              <div className="grid grid-cols-5 gap-2.5 my-4">
                {[1, 2, 3, 4, 5].map((day) => {
                  const isChecked = day < streakDay;
                  const isActive = day === streakDay && !streakClaimed;
                  const isLocked = day > streakDay || (day === streakDay && streakClaimed);

                  return (
                    <div
                      key={day}
                      className={`rounded-xl p-2 flex flex-col items-center justify-between border text-center transition-all ${
                        isChecked
                          ? "bg-[#27AE60]/10 border-[#27AE60] text-[#27AE60]"
                          : isActive
                            ? "bg-[#F7931A]/10 border-[#F7931A] text-[#F7931A] scale-105 shadow-[0_0_10px_rgba(247,147,26,0.2)] animate-pulse"
                            : "bg-[#131313] border-[#2D2D2D] text-[#555]"
                      }`}
                    >
                      <span className="text-[10px] font-bold">Day {day}</span>
                      <div className="my-1.5 font-bold text-xs">
                        {day === 5 ? "1.5x" : `+${day * 50}`}
                      </div>
                      <span className="text-[9px] uppercase font-black tracking-tight">
                        {isChecked ? "Claimed" : isActive ? "Claim" : "Locked"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Stacking claim button */}
              <button
                onClick={handleClaimStreak}
                disabled={streakClaimed}
                className={`w-full py-3.5 rounded-xl font-bold uppercase text-xs tracking-wider transition-all duration-200 ${
                  streakClaimed
                    ? "bg-[#2D2D2D] text-[#BDBDBD] border border-[#3A3A3A] cursor-not-allowed"
                    : "bg-[#F7931A] text-black hover:bg-[#ffaa3a] shadow-md transform active:scale-95"
                }`}
              >
                {streakClaimed ? "✓ Multiplier Stacked (Come Back Tomorrow)" : "⚡ CLAIM DAY 3 STACKING BONUS (+150 Sats)"}
              </button>
            </div>

            {/* AD-MONETIZED MISSIONS LIST */}
            <div className="bg-[#1A1A1A] border border-[#2D2D2D] rounded-3xl p-6 shadow-xl relative overflow-hidden">
              <h3 className="text-md font-black uppercase tracking-wide mb-1">Daily Bounty Board</h3>
              <p className="text-xs text-[#BDBDBD] mb-6">Complete sponsor tasks to stack instant rewards</p>

              <div className="space-y-4">
                {/* Mission 1 */}
                <div className="bg-[#131313] border border-[#2D2D2D] rounded-2xl p-4 flex items-center justify-between hover:border-[#3A3A3A] transition-all">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 text-lg">
                      📺
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Watch Sponsor Video</h4>
                      <p className="text-xs text-[#BDBDBD]">Earn reward from verified sponsor ad</p>
                      <span className="inline-block mt-1 text-[10px] font-bold text-[#27AE60] uppercase">
                        +150 Sats
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => startAdMission("video-ad", "Premium Sponsor Video Ad", 150)}
                    disabled={completedMissions.includes("premium-sponsor-video-ad")}
                    className={`py-2 px-4 rounded-xl text-xs font-bold transition-all ${
                      completedMissions.includes("premium-sponsor-video-ad")
                        ? "bg-[#2D2D2D]/50 text-[#BDBDBD] cursor-not-allowed"
                        : "bg-[#F7931A] text-black hover:bg-[#ffaa3a] transform active:scale-95"
                    }`}
                  >
                    {completedMissions.includes("premium-sponsor-video-ad") ? "Completed" : "Watch Ad"}
                  </button>
                </div>

                {/* Mission 2 */}
                <div className="bg-[#131313] border border-[#2D2D2D] rounded-2xl p-4 flex items-center justify-between hover:border-[#3A3A3A] transition-all">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-500 text-lg">
                      ⚡
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Interactive Interstitial</h4>
                      <p className="text-xs text-[#BDBDBD]">Test interactive miners for 5s</p>
                      <span className="inline-block mt-1 text-[10px] font-bold text-[#27AE60] uppercase">
                        +80 Sats
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => startAdMission("interstitial-ad", "Interactive Harvester Interstitial", 80)}
                    disabled={completedMissions.includes("interactive-harvester-interstitial")}
                    className={`py-2 px-4 rounded-xl text-xs font-bold transition-all ${
                      completedMissions.includes("interactive-harvester-interstitial")
                        ? "bg-[#2D2D2D]/50 text-[#BDBDBD] cursor-not-allowed"
                        : "bg-[#F7931A] text-black hover:bg-[#ffaa3a] transform active:scale-95"
                    }`}
                  >
                    {completedMissions.includes("interactive-harvester-interstitial") ? "Completed" : "Play Ad"}
                  </button>
                </div>

                {/* Mission 3 */}
                <div className="bg-[#131313] border border-[#2D2D2D] rounded-2xl p-4 flex items-center justify-between hover:border-[#3A3A3A] transition-all">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#2D9CDB]/10 border border-[#2D9CDB]/20 flex items-center justify-center text-[#2D9CDB] text-lg">
                      🐦
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Follow X Community</h4>
                      <p className="text-xs text-[#BDBDBD]">Join HashHustle announcements</p>
                      <span className="inline-block mt-1 text-[10px] font-bold text-[#27AE60] uppercase">
                        +200 Sats (Boosted!)
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setBalanceSats((prev) => prev + 200);
                      setCompletedMissions((prev) => [...prev, "follow-x-community"]);
                      setStreakMessage("🐦 Twitter Bounty Added! +200 Sats!");
                      setTimeout(() => setStreakMessage(""), 4000);
                    }}
                    disabled={completedMissions.includes("follow-x-community")}
                    className={`py-2 px-4 rounded-xl text-xs font-bold transition-all ${
                      completedMissions.includes("follow-x-community")
                        ? "bg-[#2D2D2D]/50 text-[#BDBDBD] cursor-not-allowed"
                        : "bg-[#2D9CDB] text-white hover:bg-[#56b4f0] transform active:scale-95"
                    }`}
                  >
                    {completedMissions.includes("follow-x-community") ? "Followed" : "Follow"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* COLUMN 3: VIP TIER COMPARISON & WITHDRAWAL GATEWAY */}
          <section className="space-y-6">
            
            {/* SUBSCRIPTION PLAN SELECTOR */}
            <div className="bg-[#1A1A1A] border border-[#2D2D2D] rounded-3xl p-6 shadow-xl relative overflow-hidden">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-md font-black uppercase tracking-wide">Upgrade Hashrate</h3>
                  <p className="text-xs text-[#BDBDBD]">Purchase premium sub to boost speed</p>
                </div>
                <span className="text-[10px] font-black uppercase bg-[#2D2D2D] border border-[#3A3A3A] text-white px-2 py-1 rounded">
                  Current: {activeTier.toUpperCase()}
                </span>
              </div>

              {/* Tier options stack */}
              <div className="space-y-3">
                {/* Free Plan card */}
                <div className={`p-4 rounded-2xl border transition-all ${
                  activeTier === "free"
                    ? "bg-[#2D2D2D] border-[#F7931A]/40"
                    : "bg-[#131313] border-[#222222]"
                }`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-extrabold text-sm text-[#BDBDBD]">Bronze (Free)</span>
                      <div className="text-[10px] text-[#BDBDBD]">Standard hashrate capability</div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-xs block">$0 / Month</span>
                      <span className="text-[9px] text-[#27AE60] font-bold font-mono">5 TH/s • 1.5% Withdrawal fee</span>
                    </div>
                  </div>
                </div>

                {/* Pro Plan card */}
                <div className={`p-4 rounded-2xl border transition-all cursor-pointer relative group ${
                  activeTier === "pro"
                    ? "bg-[#2D2D2D] border-[#F7931A]"
                    : "bg-[#131313] border-[#2D2D2D] hover:border-[#F7931A]/50"
                }`}
                  onClick={() => openUpgradeModal("pro")}
                >
                  {/* Glowing orange outline for Pro */}
                  <div className="absolute top-2 right-2 bg-[#F7931A] text-black text-[8px] font-black px-1.5 py-0.5 rounded uppercase">
                    Popular
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-extrabold text-sm text-[#F7931A]">Pro Plan</span>
                      <div className="text-[10px] text-[#BDBDBD]">5x Faster accumulation rate</div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-xs block">$9.99 / Month</span>
                      <span className="text-[9px] text-[#F7931A] font-bold font-mono">25 TH/s • 0.5% Withdrawal fee</span>
                    </div>
                  </div>
                </div>

                {/* Whale Plan card */}
                <div className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                  activeTier === "whale"
                    ? "bg-[#2D2D2D] border-[#FFB85C]"
                    : "bg-[#131313] border-[#2D2D2D] hover:border-[#FFB85C]/50"
                }`}
                  onClick={() => openUpgradeModal("whale")}
                >
                  {/* Subtle pulsing background glow for top tier */}
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-transparent to-purple-500/5 opacity-50"></div>
                  <div className="absolute top-2 right-2 bg-gradient-to-r from-purple-600 to-[#F7931A] text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase">
                    VIP Whale
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-extrabold text-sm text-purple-400">Whale Plan</span>
                      <div className="text-[10px] text-[#BDBDBD]">20x Fast speed. No fees ever.</div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-xs block">$29.99 / Month</span>
                      <span className="text-[9px] text-purple-400 font-bold font-mono">100 TH/s • NO Payout Fees!</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* WITHDRAWAL GATEWAY SECTION */}
            <div className="bg-[#1A1A1A] border border-[#2D2D2D] rounded-3xl p-6 shadow-xl relative overflow-hidden">
              <h3 className="text-md font-black uppercase tracking-wide mb-1">Bitcoin Cashout</h3>
              <p className="text-xs text-[#BDBDBD] mb-4">Transfer Satoshis directly to on-chain wallet</p>

              {/* Progress toward 10k Sats threshold */}
              <div className="mb-6 font-mono text-xs">
                <div className="flex justify-between text-[10px] text-[#BDBDBD] uppercase font-bold mb-1">
                  <span>Threshold Progress</span>
                  <span>{Math.min(Math.round((balanceSats / 10000) * 100), 100)}%</span>
                </div>
                <div className="h-2.5 w-full bg-[#131313] rounded-full border border-[#2D2D2D] overflow-hidden flex">
                  <div
                    className="bg-gradient-to-r from-[#F7931A] to-[#FFB85C] h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((balanceSats / 10000) * 100, 100)}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[10px] text-[#BDBDBD] mt-1">
                  <span>{balanceSats.toFixed(0)} Sats</span>
                  <span>10,000 Sats Min</span>
                </div>
              </div>

              {withdrawalSuccess ? (
                <div className="bg-[#27AE60]/10 border border-[#27AE60]/40 rounded-2xl p-5 text-center">
                  <div className="text-4xl mb-2">🎉</div>
                  <h4 className="text-sm font-black text-[#27AE60] uppercase mb-1">Withdrawal Successful</h4>
                  <p className="text-xs text-[#BDBDBD] mb-3">
                    Your payout has been dispatched successfully over the on-chain blockchain.
                  </p>
                  <div className="bg-[#131313] border border-[#2D2D2D] p-3 rounded-xl mb-4 font-mono text-[10px] select-all break-all text-white">
                    TxID: {withdrawalTxId}
                  </div>
                  <button
                    onClick={resetWithdrawalScreen}
                    className="text-xs text-[#F7931A] font-bold underline hover:text-[#ffaa3a]"
                  >
                    Request Another Cashout
                  </button>
                </div>
              ) : (
                <form onSubmit={handleWithdrawal} className="space-y-4">
                  {withdrawError && (
                    <div className="bg-[#EB5757]/10 border border-[#EB5757]/40 text-[#EB5757] p-3 rounded-xl text-xs font-semibold">
                      ⚠ {withdrawError}
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[#BDBDBD] mb-1.5">
                      Satoshi Cashout Amount
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        disabled
                        value={`${balanceSats.toFixed(0)} Sats`}
                        className="w-full bg-[#131313] border border-[#2D2D2D] rounded-xl py-3 px-4 text-xs font-mono font-bold text-white cursor-not-allowed"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-[#27AE60] font-black uppercase tracking-wider">
                        All Sats Selected
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-[#BDBDBD] mb-1.5">
                      Destination Bitcoin Wallet Address
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
                      value={withdrawAddress}
                      onChange={(e) => setWithdrawAddress(e.target.value)}
                      className="w-full bg-[#131313] border border-[#2D2D2D] rounded-xl py-3 px-4 text-xs font-mono text-white placeholder-[#555] focus:outline-none focus:border-[#F7931A] transition-all"
                    />
                  </div>

                  {/* Transaction fee info breakdown */}
                  <div className="bg-[#131313] border border-[#2D2D2D] rounded-xl p-3 font-mono text-[10px] space-y-1.5 text-[#BDBDBD]">
                    <div className="flex justify-between">
                      <span>Tier Flat Fee Rate:</span>
                      <span className="text-white font-bold">{(withdrawalFeeRate * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Withdrawal service fee:</span>
                      <span className="text-[#EB5757] font-bold">-{currentWithdrawFee} Sats</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-[#222222] text-xs font-bold">
                      <span className="text-white">Estimated Net Received:</span>
                      <span className="text-[#27AE60]">
                        {Math.max(0, Math.round(balanceSats - currentWithdrawFee))} Sats
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={balanceSats < 10000 || isWithdrawing}
                    className={`w-full py-4 rounded-xl font-black uppercase text-xs tracking-wider transition-all duration-300 ${
                      balanceSats < 10000
                        ? "bg-[#2D2D2D] text-[#555] cursor-not-allowed border border-[#3A3A3A]"
                        : "bg-[#F7931A] text-black hover:bg-[#ffaa3a] shadow-lg transform active:scale-95"
                    }`}
                  >
                    {isWithdrawing ? "Processing Block Transaction..." : "DISPATCH ON-CHAIN TRANSACTION"}
                  </button>
                </form>
              )}
            </div>
          </section>

        </div>
      </div>

      {/* FOOTER AREA */}
      <footer className="border-t border-[#2D2D2D] bg-[#1A1A1A] mt-16 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-[#BDBDBD]">
          <div className="flex items-center gap-2">
            <span className="text-[#F7931A] font-extrabold text-sm">₿</span>
            <span className="font-bold text-white">{businessName || "HashHustle"} Interactive Design System</span>
          </div>
          <div>
            Design ratified by owner on 2026-07-02. Built with <a href="https://cto.new" className="underline hover:text-white transition-all">cto.new</a>
          </div>
        </div>
      </footer>

      {/* VIDEO SPONSOR AD OVERLAY MODAL */}
      {adModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1A1A1A] border border-[#F7931A]/30 rounded-3xl max-w-md w-full p-6 text-center relative overflow-hidden shadow-[0_0_50px_rgba(247,147,26,0.15)]">
            {/* Top border header */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-[#F7931A] to-red-500"></div>

            <div className="flex justify-between items-center mb-6">
              <span className="text-[10px] font-black uppercase bg-[#222222] border border-[#333] px-2.5 py-1 rounded text-red-500 tracking-wider">
                ● Sponsored Ad Stream
              </span>
              <span className="text-xs font-mono font-bold text-white bg-[#131313] border border-[#2D2D2D] px-3 py-1 rounded-full">
                {adCountdown > 0 ? `Unlocks in ${adCountdown}s` : "✓ Reward Unlocked"}
              </span>
            </div>

            {/* Fake Video Player Screen Mockup */}
            <div className="relative aspect-video w-full rounded-2xl bg-black border border-[#2D2D2D] overflow-hidden flex flex-col items-center justify-center mb-6 shadow-inner group">
              {/* Background gradient lines to look technical */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-neutral-900 via-black to-black"></div>
              
              {/* Spinning loading spinner or checkmark */}
              {adCountdown > 0 ? (
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-full border-4 border-[#F7931A]/20 border-t-[#F7931A] animate-spin mb-3"></div>
                  <div className="text-[10px] uppercase font-bold text-[#BDBDBD]">Streaming Sponsor Media</div>
                </div>
              ) : (
                <div className="relative z-10 text-center animate-bounce">
                  <div className="w-14 h-14 rounded-full bg-[#27AE60]/20 border-2 border-[#27AE60] flex items-center justify-center text-[#27AE60] text-xl font-bold mx-auto mb-3">
                    ✓
                  </div>
                  <div className="text-[10px] uppercase font-black text-[#27AE60]">Ad Completed Successfully</div>
                </div>
              )}
            </div>

            <h3 className="text-md font-black uppercase text-white mb-2">{activeAdTitle}</h3>
            <p className="text-xs text-[#BDBDBD] mb-6">
              Watching this verified short advertisement supports the HashHustle free-mining community pools and unlocks instant rewards.
            </p>

            <div className="flex gap-4">
              <button
                onClick={claimAdReward}
                disabled={!adWatchFinished}
                className={`w-full py-4 rounded-xl font-black uppercase text-xs tracking-wider transition-all duration-300 ${
                  !adWatchFinished
                    ? "bg-[#2D2D2D] text-[#555] cursor-not-allowed border border-[#3A3A3A]"
                    : "bg-[#27AE60] text-black hover:bg-[#2ecc71] shadow-[0_0_15px_rgba(39,174,96,0.3)] transform active:scale-95"
                }`}
              >
                {adWatchFinished ? `CLAIM +${activeAdReward} SATOSHIS` : `STREAMING VIDEO AD (${adCountdown}S)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IN-APP SUBSCRIPTION PURCHASE UPGRADE OVERLAY MODAL */}
      {subModalOpen && subModalTier && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1A1A1A] border border-[#2D2D2D] rounded-3xl max-w-sm w-full p-6 text-center relative overflow-hidden shadow-2xl">
            {/* Top gold border header */}
            <div className="absolute top-0 left-0 w-full h-1 bg-[#F7931A]"></div>

            <div className="text-4xl my-4">📱</div>
            <h3 className="text-lg font-black uppercase text-white mb-1">Confirm Subscription</h3>
            <p className="text-xs text-[#BDBDBD] mb-6">HashHustle Premium Miner Tier</p>

            {/* In-App Purchase detail summary */}
            <div className="bg-[#131313] border border-[#2D2D2D] rounded-2xl p-4 text-left font-mono text-xs mb-6 space-y-3">
              <div className="flex justify-between border-b border-[#222222] pb-2">
                <span className="text-[#BDBDBD]">Product:</span>
                <span className="text-white font-bold uppercase">{subModalTier} Mining Engine Upgrade</span>
              </div>
              <div className="flex justify-between border-b border-[#222222] pb-2">
                <span className="text-[#BDBDBD]">Hashrate Speed:</span>
                <span className="text-[#F7931A] font-bold">{subModalTier === "whale" ? "100.0 TH/s (20x Boost)" : "25.0 TH/s (5x Boost)"}</span>
              </div>
              <div className="flex justify-between border-b border-[#222222] pb-2">
                <span className="text-[#BDBDBD]">On-chain Fee:</span>
                <span className="text-[#27AE60] font-bold">{subModalTier === "whale" ? "0% (No Fees Forever)" : "0.5% Flat Rate"}</span>
              </div>
              <div className="flex justify-between pt-1 font-bold text-sm">
                <span className="text-white">Price:</span>
                <span className="text-white">{subModalTier === "whale" ? "$29.99" : "$9.99"} / Month</span>
              </div>
            </div>

            {subscribingState === "idle" && (
              <div className="space-y-3">
                <button
                  onClick={processMockPurchase}
                  className="w-full py-4 rounded-xl bg-[#F7931A] text-black font-black uppercase text-xs tracking-wider hover:bg-[#ffaa3a] transition-all transform active:scale-95 shadow-lg"
                >
                  Pay with Simulated Wallet
                </button>
                <button
                  onClick={() => setSubModalOpen(false)}
                  className="w-full py-3 rounded-xl bg-transparent border border-[#2D2D2D] text-[#BDBDBD] font-bold text-xs hover:text-white transition-all"
                >
                  Cancel Purchase
                </button>
              </div>
            )}

            {subscribingState === "authenticating" && (
              <div className="py-6 flex flex-col items-center justify-center">
                <div className="w-10 h-10 border-4 border-[#F7931A]/20 border-t-[#F7931A] rounded-full animate-spin mb-4"></div>
                <div className="text-xs font-bold text-white uppercase tracking-wider">Simulating FaceID / Wallet Verification...</div>
              </div>
            )}

            {subscribingState === "success" && (
              <div className="py-6 flex flex-col items-center justify-center animate-bounce text-[#27AE60]">
                <div className="w-12 h-12 bg-[#27AE60]/10 border-2 border-[#27AE60] rounded-full flex items-center justify-center text-xl font-bold mb-4">
                  ✓
                </div>
                <div className="text-xs font-black uppercase tracking-wider">Purchase Authenticated Successfully!</div>
              </div>
            )}

          </div>
        </div>
      )}

    </main>
  );
}
