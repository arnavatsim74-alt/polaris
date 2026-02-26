import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Clock, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface ExamQuestion {
  id: string;
  question: string;
  options: { text: string; is_correct: boolean }[];
  explanation?: string;
  sort_order: number;
}

export default function AcademyExam() {
  const { examId } = useParams<{ examId: string }>();
  const { pilot } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const recruitmentToken = searchParams.get("recruitmentToken");
  const isRecruitmentMode = !!recruitmentToken;
  const canAccessExam = !!pilot?.id || isRecruitmentMode;
  const queryClient = useQueryClient();

  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);

  const { data: exam } = useQuery({
    queryKey: ["academy-exam", examId],
    queryFn: async () => {
      const { data } = await supabase.from("academy_exams").select("*").eq("id", examId!).single();
      return data;
    },
    enabled: !!examId && canAccessExam,
  });

  const { data: questions } = useQuery({
    queryKey: ["academy-exam-questions", examId],
    queryFn: async () => {
      const { data } = await supabase.from("academy_exam_questions").select("*").eq("exam_id", examId!).order("sort_order");
      return (data || []) as unknown as ExamQuestion[];
    },
    enabled: !!examId && canAccessExam,
  });

  const { data: previousAttempts } = useQuery({
    queryKey: ["academy-exam-attempts", pilot?.id, examId],
    queryFn: async () => {
      if (!pilot?.id) return [];
      const { data } = await supabase
        .from("academy_exam_attempts")
        .select("*")
        .eq("pilot_id", pilot.id)
        .eq("exam_id", examId!)
        .order("started_at", { ascending: false });
      return data || [];
    },
    enabled: !!pilot?.id && !!examId && !isRecruitmentMode,
  });

  // Timer
  useEffect(() => {
    if (!exam?.time_limit_minutes || isSubmitted || !attemptId) return;
    setTimeLeft(exam.time_limit_minutes * 60);
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 0) {
          clearInterval(interval);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [exam, attemptId]);

  const startExamMutation = useMutation({
    mutationFn: async () => {
      if (!examId) throw new Error("Missing exam id");
      if (isRecruitmentMode) {
        return { id: `recruitment-${Date.now()}` } as any;
      }
      if (!pilot?.id) throw new Error("Please log in to take this exam");
      const { data, error } = await supabase.from("academy_exam_attempts").insert({
        pilot_id: pilot.id,
        exam_id: examId,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setAttemptId(data.id);
      setAnswers({});
      setCurrentQuestion(0);
      setIsSubmitted(false);
    },
    onError: (e: any) => toast.error(e?.message || "Failed to start exam"),
  });

  const handleSubmit = async () => {
    if (!questions || !attemptId) return;
    
    let correct = 0;
    questions.forEach(q => {
      const selectedIdx = answers[q.id];
      if (selectedIdx !== undefined && q.options[selectedIdx]?.is_correct) {
        correct++;
      }
    });

    const calculatedScore = Math.round((correct / questions.length) * 100);
    const passed = calculatedScore >= (exam?.passing_score || 70);

    setScore(calculatedScore);
    setIsSubmitted(true);

    if (isRecruitmentMode && recruitmentToken) {
      const { error } = await supabase.rpc("submit_recruitment_exam", {
        p_token: recruitmentToken,
        p_score: calculatedScore,
        p_passed: passed,
      });
      if (error) {
        toast.error(error.message || "Failed to submit recruitment exam");
        return;
      }
      toast[passed ? "success" : "error"](passed ? `Passed with ${calculatedScore}%! Return to Discord and click Set Preferred Callsign to finish approval.` : `Failed with ${calculatedScore}%`);
      return;
    }

    await supabase.from("academy_exam_attempts").update({
      score: calculatedScore,
      passed,
      answers,
      completed_at: new Date().toISOString(),
    }).eq("id", attemptId);

    queryClient.invalidateQueries({ queryKey: ["academy-exam-attempts"] });
    toast[passed ? "success" : "error"](passed ? `Passed with ${calculatedScore}%!` : `Failed with ${calculatedScore}%`);
  };

  if (!canAccessExam) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-8 flex items-center justify-center">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle>Login Required</CardTitle>
            <CardDescription>
              Please log in for normal academy exams, or open the recruitment exam link from Discord that includes a recruitment token.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/auth")}>Go to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const attemptsUsed = isRecruitmentMode ? 0 : (previousAttempts?.length || 0);
  const maxAttempts = exam?.max_attempts || 3;
  const canAttempt = isRecruitmentMode ? true : attemptsUsed < maxAttempts;
  const hasPassed = isRecruitmentMode ? false : previousAttempts?.some(a => a.passed);
  const currentQ = questions?.[currentQuestion];

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (!exam) return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card><CardContent className="py-10 text-center text-muted-foreground">Loading exam...</CardContent></Card>
    </div>
  );

  // Pre-exam screen
  if (!attemptId && !isSubmitted) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>{exam.title}</CardTitle>
            <CardDescription>{exam.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Questions</span><span>{questions?.length || 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Passing Score</span><span>{exam.passing_score}%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Time Limit</span><span>{exam.time_limit_minutes ? `${exam.time_limit_minutes} min` : "Unlimited"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Attempts</span><span>{attemptsUsed}/{maxAttempts}</span></div>
            </div>
            {hasPassed && (
              <div className="p-3 bg-green-500/10 rounded-lg flex items-center gap-2 text-green-600">
                <CheckCircle className="h-4 w-4" /> You have already passed this exam
              </div>
            )}
            {previousAttempts && previousAttempts.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Previous Attempts</h4>
                {previousAttempts.map((a, i) => (
                  <div key={a.id} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                    <span>Attempt {previousAttempts.length - i}</span>
                    <Badge variant={a.passed ? "default" : "destructive"}>{a.score}%</Badge>
                  </div>
                ))}
              </div>
            )}
            <Button className="w-full" onClick={() => startExamMutation.mutate()} disabled={!canAttempt || startExamMutation.isPending}>
              {!canAttempt ? "No attempts remaining" : (isRecruitmentMode ? "Start Recruitment Exam" : "Start Exam")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Results screen
  if (isSubmitted) {
    const passed = score >= (exam.passing_score || 70);
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Card>
          <CardHeader className="text-center">
            {passed ? <CheckCircle className="h-16 w-16 mx-auto text-green-500 mb-2" /> : <XCircle className="h-16 w-16 mx-auto text-destructive mb-2" />}
            <CardTitle>{passed ? "Congratulations!" : "Not Quite"}</CardTitle>
            <CardDescription>You scored {score}% — {passed ? "You passed!" : `You needed ${exam.passing_score}%`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {questions?.map((q, idx) => {
              const selectedIdx = answers[q.id];
              const isCorrect = selectedIdx !== undefined && q.options[selectedIdx]?.is_correct;
              return (
                <div key={q.id} className={`p-3 rounded-lg border ${isCorrect ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
                  <p className="text-sm font-medium mb-1">Q{idx + 1}: {q.question}</p>
                  <p className="text-xs text-muted-foreground">
                    Your answer: {selectedIdx !== undefined ? q.options[selectedIdx]?.text : "Not answered"}
                  </p>
                  {!isCorrect && <p className="text-xs text-green-600 mt-1">Correct: {q.options.find(o => o.is_correct)?.text}</p>}
                  {q.explanation && <p className="text-xs text-muted-foreground mt-1 italic">{q.explanation}</p>}
                </div>
              );
            })}
            <Button className="w-full" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Active exam
  if (!currentQ) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{exam.title}</h2>
        {timeLeft !== null && (
          <Badge variant={timeLeft < 60 ? "destructive" : "secondary"} className="gap-1">
            <Clock className="h-3 w-3" /> {formatTime(timeLeft)}
          </Badge>
        )}
      </div>

      <Progress value={((currentQuestion + 1) / (questions?.length || 1)) * 100} className="h-2" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Question {currentQuestion + 1} of {questions?.length}</CardTitle>
          <CardDescription className="text-foreground text-base mt-2">{currentQ.question}</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={answers[currentQ.id]?.toString()}
            onValueChange={(v) => setAnswers({ ...answers, [currentQ.id]: parseInt(v) })}
          >
            {currentQ.options.map((opt, idx) => (
              <div key={idx} className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value={idx.toString()} id={`opt-${idx}`} />
                <Label htmlFor={`opt-${idx}`} className="flex-1 cursor-pointer">{opt.text}</Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))} disabled={currentQuestion === 0}>
          Previous
        </Button>
        {currentQuestion < (questions?.length || 0) - 1 ? (
          <Button onClick={() => setCurrentQuestion(currentQuestion + 1)}>Next</Button>
        ) : (
          <Button onClick={handleSubmit} variant="default">
            Submit Exam
          </Button>
        )}
      </div>
    </div>
  );
}
