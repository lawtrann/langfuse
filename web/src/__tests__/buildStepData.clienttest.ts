// No test dependencies from shared
vi.mock("@langfuse/shared", () => ({
  ObservationType: {
    SPAN: "SPAN",
    EVENT: "EVENT",
    GENERATION: "GENERATION",
    AGENT: "AGENT",
    TOOL: "TOOL",
    CHAIN: "CHAIN",
    RETRIEVER: "RETRIEVER",
    EVALUATOR: "EVALUATOR",
    EMBEDDING: "EMBEDDING",
    GUARDRAIL: "GUARDRAIL",
  },
}));

import { buildStepData } from "@/src/features/trace-graph-view/buildStepData";
import { type AgentGraphDataResponse } from "@/src/features/trace-graph-view/types";

describe("buildStepData", () => {
  const createMockObservation = (
    overrides: Partial<AgentGraphDataResponse> = {},
  ): AgentGraphDataResponse => ({
    id: "mock-id",
    name: "mock-name",
    node: null,
    step: null,
    parentObservationId: null,
    startTime: "2025-08-21 18:53:25.571",
    endTime: "2025-08-21 18:53:25.587",
    observationType: "AGENT",
    ...overrides,
  });

  describe("basic sequential timing", () => {
    it("should put sequential observations in different steps", () => {
      const observations: AgentGraphDataResponse[] = [
        createMockObservation({
          id: "obs1",
          name: "first",
          startTime: "2025-08-21 18:53:25.000",
          endTime: "2025-08-21 18:53:25.100",
        }),
        createMockObservation({
          id: "obs2",
          name: "second",
          startTime: "2025-08-21 18:53:25.200", // Starts after first ends
          endTime: "2025-08-21 18:53:25.300",
        }),
      ];

      const result = buildStepData(observations);

      // Remove system nodes for easier testing
      const userObservations = result.filter((obs) => !obs.name.includes("__"));

      expect(userObservations).toHaveLength(2);

      const first = userObservations.find((obs) => obs.name === "first");
      const second = userObservations.find((obs) => obs.name === "second");

      expect(first?.step).toBe(1);
      expect(second?.step).toBe(2);
    });
  });

  describe("overlapping observations", () => {
    it("should put overlapping observations in same step", () => {
      const observations: AgentGraphDataResponse[] = [
        createMockObservation({
          id: "obs1",
          name: "first",
          startTime: "2025-08-21 18:53:25.000",
          endTime: "2025-08-21 18:53:25.200",
        }),
        createMockObservation({
          id: "obs2",
          name: "second",
          startTime: "2025-08-21 18:53:25.100", // Starts before first ends
          endTime: "2025-08-21 18:53:25.300",
        }),
      ];

      const result = buildStepData(observations);

      const userObservations = result.filter((obs) => !obs.name.includes("__"));

      expect(userObservations).toHaveLength(2);

      const first = userObservations.find((obs) => obs.name === "first");
      const second = userObservations.find((obs) => obs.name === "second");

      expect(first?.step).toBe(1);
      expect(second?.step).toBe(1); // Same step due to overlap
    });

    it("should handle multiple parallel observations in same step", () => {
      const observations: AgentGraphDataResponse[] = [
        createMockObservation({
          id: "obs1",
          name: "first",
          startTime: "2025-08-21 18:53:25.000",
          endTime: "2025-08-21 18:53:25.300",
        }),
        createMockObservation({
          id: "obs2",
          name: "second",
          startTime: "2025-08-21 18:53:25.050", // Overlaps with first
          endTime: "2025-08-21 18:53:25.250",
        }),
        createMockObservation({
          id: "obs3",
          name: "third",
          startTime: "2025-08-21 18:53:25.150", // Overlaps with both first and second
          endTime: "2025-08-21 18:53:25.400",
        }),
        createMockObservation({
          id: "obs4",
          name: "fourth",
          startTime: "2025-08-21 18:53:25.500", // Starts after all others end - should be step 2
          endTime: "2025-08-21 18:53:25.600",
        }),
      ];

      const result = buildStepData(observations);

      const userObservations = result.filter((obs) => !obs.name.includes("__"));
      expect(userObservations).toHaveLength(4);

      const first = userObservations.find((obs) => obs.name === "first");
      const second = userObservations.find((obs) => obs.name === "second");
      const third = userObservations.find((obs) => obs.name === "third");
      const fourth = userObservations.find((obs) => obs.name === "fourth");

      // First three should all be in step 1 (parallel execution)
      expect(first?.step).toBe(1);
      expect(second?.step).toBe(1);
      expect(third?.step).toBe(1);

      // Fourth starts after all others end, so step 2 (sequential)
      expect(fourth?.step).toBe(2);
    });

    it("should handle complex cleanup scenario - observation added then kicked out", () => {
      const observations: AgentGraphDataResponse[] = [
        createMockObservation({
          id: "obs1",
          name: "long_task",
          startTime: "2025-08-21 18:53:25.000",
          endTime: "2025-08-21 18:53:25.500", // Long running task
        }),
        createMockObservation({
          id: "obs2",
          name: "short_overlap",
          startTime: "2025-08-21 18:53:25.100", // Starts before long_task ends (gets added to group)
          endTime: "2025-08-21 18:53:25.150", // But ends early
        }),
        createMockObservation({
          id: "obs3",
          name: "late_start",
          startTime: "2025-08-21 18:53:25.200", // Starts after short_overlap ends (gets kicked out during cleanup)
          endTime: "2025-08-21 18:53:25.300",
        }),
        createMockObservation({
          id: "obs4",
          name: "independent",
          startTime: "2025-08-21 18:53:25.600", // Completely separate, should be step 3
          endTime: "2025-08-21 18:53:25.700",
        }),
      ];

      const result = buildStepData(observations);

      const userObservations = result.filter((obs) => !obs.name.includes("__"));
      expect(userObservations).toHaveLength(4);

      const longTask = userObservations.find((obs) => obs.name === "long_task");
      const shortOverlap = userObservations.find(
        (obs) => obs.name === "short_overlap",
      );
      const lateStart = userObservations.find(
        (obs) => obs.name === "late_start",
      );
      const independent = userObservations.find(
        (obs) => obs.name === "independent",
      );

      // Expected behavior:
      // Step 1: long_task, short_overlap (they overlap)
      // late_start initially gets added because it starts before long_task ends (200 < 500)
      // BUT during cleanup, late_start gets kicked out because it starts after short_overlap ends (200 >= 150)
      // Step 2: late_start (processed in recursive call)
      // Step 3: independent (completely separate)

      expect(longTask?.step).toBe(1);
      expect(shortOverlap?.step).toBe(1); // Overlaps with long_task
      expect(lateStart?.step).toBe(2); // Kicked out during cleanup, processed recursively
      expect(independent?.step).toBe(3); // Sequential after everything else
    });
  });

  describe("parent-child constraints", () => {
    it("should enforce parent-child step ordering", () => {
      const observations: AgentGraphDataResponse[] = [
        createMockObservation({
          id: "parent",
          name: "parent_task",
          startTime: "2025-08-21 18:53:25.000",
          endTime: "2025-08-21 18:53:25.100",
          parentObservationId: null,
        }),
        createMockObservation({
          id: "child",
          name: "child_task",
          startTime: "2025-08-21 18:53:25.050", // Overlaps with parent
          endTime: "2025-08-21 18:53:25.150",
          parentObservationId: "parent",
        }),
      ];

      const result = buildStepData(observations);

      const userObservations = result.filter((obs) => !obs.name.includes("__"));

      const parent = userObservations.find((obs) => obs.name === "parent_task");
      const child = userObservations.find((obs) => obs.name === "child_task");

      expect(parent?.step).toBe(1);
      expect(child?.step).toBe(2); // Must be after parent despite timing overlap
    });

    it("should push subsequent steps forward when inserting child", () => {
      const observations: AgentGraphDataResponse[] = [
        // Parent in step 1
        createMockObservation({
          id: "parent",
          name: "parent_task",
          startTime: "2025-08-21 18:53:25.000",
          endTime: "2025-08-21 18:53:25.100",
          parentObservationId: null,
        }),
        // Child that would be step 1 due to timing, but should be step 2 due to parent constraint
        createMockObservation({
          id: "child",
          name: "child_task",
          startTime: "2025-08-21 18:53:25.050",
          endTime: "2025-08-21 18:53:25.080",
          parentObservationId: "parent",
        }),
        // Independent task that would be step 2 due to timing, should be pushed to step 3
        createMockObservation({
          id: "independent",
          name: "independent_task",
          startTime: "2025-08-21 18:53:25.200",
          endTime: "2025-08-21 18:53:25.300",
          parentObservationId: null,
        }),
      ];

      const result = buildStepData(observations);

      const userObservations = result.filter((obs) => !obs.name.includes("__"));

      const parent = userObservations.find((obs) => obs.name === "parent_task");
      const child = userObservations.find((obs) => obs.name === "child_task");
      const independent = userObservations.find(
        (obs) => obs.name === "independent_task",
      );

      expect(parent?.step).toBe(1);
      expect(child?.step).toBe(2); // Inserted due to parent constraint
      expect(independent?.step).toBe(3); // Pushed forward
    });

    it("should handle parent appearing after child in array processing order", () => {
      const observations: AgentGraphDataResponse[] = [
        // Child appears FIRST in array (would be processed first in loop)
        createMockObservation({
          id: "child",
          name: "child_task",
          startTime: "2025-08-21 18:53:25.050", // Overlaps with parent timing-wise
          endTime: "2025-08-21 18:53:25.080",
          parentObservationId: "parent",
        }),
        // Parent appears SECOND in array (would be processed second in loop)
        createMockObservation({
          id: "parent",
          name: "parent_task",
          startTime: "2025-08-21 18:53:25.000",
          endTime: "2025-08-21 18:53:25.100",
          parentObservationId: null,
        }),
      ];

      const result = buildStepData(observations);
      const userObservations = result.filter((obs) => !obs.name.includes("__"));

      const parent = userObservations.find((obs) => obs.name === "parent_task");
      const child = userObservations.find((obs) => obs.name === "child_task");

      // Should still enforce parent-child constraint despite processing order
      expect(parent?.step).toBe(1);
      expect(child?.step).toBe(2);
    });
  });

  describe("real scenario - joke evaluation case", () => {
    it("should handle the create_joke_evaluation_agent and get_joke_database_inspiration case", () => {
      const observations: AgentGraphDataResponse[] = [
        createMockObservation({
          id: "785eaa36815cb1fa",
          name: "run_smolagents_joke_evaluation",
          startTime: "2025-08-21 18:53:25.570",
          endTime: "2025-08-21 18:53:40.573",
          parentObservationId: null,
        }),
        createMockObservation({
          id: "b8fcc9d3cf148524",
          name: "create_joke_evaluation_agent",
          startTime: "2025-08-21 18:53:25.571",
          endTime: "2025-08-21 18:53:25.587",
          parentObservationId: "785eaa36815cb1fa",
        }),
        createMockObservation({
          id: "55821479672f1de5",
          name: "get_joke_database_inspiration",
          startTime: "2025-08-21 18:53:27.446", // Starts after create_joke ends
          endTime: "2025-08-21 18:53:27.446",
          parentObservationId: "785eaa36815cb1fa",
        }),
      ];

      const result = buildStepData(observations);

      const userObservations = result.filter((obs) => !obs.name.includes("__"));

      const runAgent = userObservations.find(
        (obs) => obs.name === "run_smolagents_joke_evaluation",
      );
      const createAgent = userObservations.find(
        (obs) => obs.name === "create_joke_evaluation_agent",
      );
      const getData = userObservations.find(
        (obs) => obs.name === "get_joke_database_inspiration",
      );

      expect(runAgent?.step).toBe(1);
      expect(createAgent?.step).toBe(2); // Child of run_agent, so step 2
      expect(getData?.step).toBe(3); // Child of run_agent, but starts after create_agent ends, so step 3
    });
  });

  describe("edge cases", () => {
    it("should handle child starting before parent causing infinite loop (bug from trace 9f6079ff)", () => {
      // child starts BEFORE parent, creating infinite loop, see LFE-7096
      // The key is having multiple nested levels with same start times
      const observations: AgentGraphDataResponse[] = [
        createMockObservation({
          id: "root",
          name: "Root",
          startTime: "2025-10-07 12:27:33.826",
          endTime: "2025-10-07 12:27:33.829",
          parentObservationId: null,
        }),
        createMockObservation({
          id: "sibling1",
          name: "Sibling1",
          startTime: "2025-10-07 12:27:33.830",
          endTime: "2025-10-07 12:27:33.830",
          parentObservationId: "root",
        }),
        createMockObservation({
          id: "sibling2",
          name: "Sibling2",
          startTime: "2025-10-07 12:27:33.830",
          endTime: "2025-10-07 12:27:33.830",
          parentObservationId: "root",
        }),
        createMockObservation({
          id: "parent",
          name: "Parent",
          startTime: "2025-10-07 12:27:33.846", // Starts AFTER child
          endTime: "2025-10-07 12:27:39.276",
          parentObservationId: "root",
        }),
        createMockObservation({
          id: "child",
          name: "Child",
          startTime: "2025-10-07 12:27:33.830", // Starts BEFORE parent!
          endTime: "2025-10-07 12:27:39.274",
          parentObservationId: "parent",
        }),
        createMockObservation({
          id: "grandchild",
          name: "Grandchild",
          startTime: "2025-10-07 12:27:33.830",
          endTime: "2025-10-07 12:27:36.437",
          parentObservationId: "child",
        }),
        createMockObservation({
          id: "ggchild1",
          name: "GGChild1",
          startTime: "2025-10-07 12:27:33.830",
          endTime: "2025-10-07 12:27:33.830",
          parentObservationId: "grandchild",
        }),
        createMockObservation({
          id: "ggchild2",
          name: "GGChild2",
          startTime: "2025-10-07 12:27:33.830",
          endTime: "2025-10-07 12:27:33.830",
          parentObservationId: "grandchild",
        }),
        createMockObservation({
          id: "gggchild",
          name: "GGGChild",
          startTime: "2025-10-07 12:27:33.866",
          endTime: "2025-10-07 12:27:36.435",
          parentObservationId: "grandchild",
        }),
        createMockObservation({
          id: "ggggchild",
          name: "GGGGChild",
          startTime: "2025-10-07 12:27:33.866",
          endTime: "2025-10-07 12:27:36.434",
          parentObservationId: "gggchild",
        }),
      ];

      const result = buildStepData(observations);

      const userObservations = result.filter((obs) => !obs.name.includes("__"));
      const parent = userObservations.find((o) => o.name === "Parent");
      const child = userObservations.find((o) => o.name === "Child");

      // Constraint must be enforced
      expect(parent!.step!).toBeLessThan(child!.step!);
    });

    it("should handle empty array", () => {
      const result = buildStepData([]);
      // Should only have system nodes (__start__, __end__)
      expect(result).toHaveLength(2);
      expect(result.every((obs) => obs.name.includes("__"))).toBe(true);
    });

    it(
      "should handle large number of observations with identical timestamps just below limit",
      { timeout: 5000 },
      () => {
        // This tests the edge case: create exactly 249 SPAN observations
        // with complex timing patterns that could cause infinite recursion

        const observations: AgentGraphDataResponse[] = [];
        const baseTime = new Date("2025-08-28T19:32:09.000Z").getTime();

        // Create exactly 249 SPAN observations to test the edge case just under the limit
        for (let i = 0; i < 249; i++) {
          // Create pathological timing patterns:
          // - Many observations with identical start times
          // - Zero duration observations
          // - Complex parent-child relationships
          const groupIndex = Math.floor(i / 20); // Group every 20 observations
          const sameStartTime = baseTime + groupIndex * 100; // Same start time for each group
          const zeroDuration = i % 3 === 0; // Every 3rd observation has zero duration

          observations.push(
            createMockObservation({
              id: `span_${i.toString().padStart(3, "0")}`,
              name: `complex_task_${i}`,
              startTime: new Date(sameStartTime).toISOString(),
              endTime: new Date(
                sameStartTime + (zeroDuration ? 0 : 10 + (i % 5)),
              ).toISOString(),
              parentObservationId:
                i === 0
                  ? null
                  : `span_${Math.max(0, i - 5)
                      .toString()
                      .padStart(3, "0")}`,
              observationType: "SPAN", // All SPANs, no EVENTs to avoid filtering
            }),
          );
        }

        // 5 second timeout to catch infinite recursion is set via test options

        expect(() => {
          const result = buildStepData(observations);

          // Should process successfully without infinite recursion
          expect(result).toBeDefined();
          expect(Array.isArray(result)).toBe(true);
          // Should have more than 0 results since we're under the limit
          expect(result.length).toBeGreaterThan(0);
        }).not.toThrow();
      },
    );

    it("should handle single observation", () => {
      const observations: AgentGraphDataResponse[] = [
        createMockObservation({
          id: "single",
          name: "single_task",
        }),
      ];

      const result = buildStepData(observations);

      // Should have single observation plus system nodes
      const userObservations = result.filter((obs) => !obs.name.includes("__"));
      expect(userObservations).toHaveLength(1);
      expect(userObservations[0].step).toBe(1);
    });

    it("should filter out EVENT observation types", () => {
      const observations: AgentGraphDataResponse[] = [
        createMockObservation({
          id: "agent",
          name: "agent_task",
          observationType: "AGENT",
        }),
        createMockObservation({
          id: "span",
          name: "span_task",
          observationType: "SPAN", // Currently not filtered out
        }),
        createMockObservation({
          id: "event",
          name: "event_task",
          observationType: "EVENT", // Should be filtered out
        }),
      ];

      const result = buildStepData(observations);

      const userObservations = result.filter((obs) => !obs.name.includes("__"));
      expect(userObservations).toHaveLength(2);
      expect(userObservations[0].name).toBe("agent_task");
      expect(userObservations[1].name).toBe("span_task");
    });
  });

  describe("real scenario - Claude Code nested agent trace", () => {
    it("should handle nested agent with generations, spans, and tools", () => {
      // Real API response data (array order matches actual ClickHouse query result)
      const observations: AgentGraphDataResponse[] = [
        {
          id: "5d3c0830995c7658",
          node: "",
          step: 0,
          parentObservationId: "0af07492079065ee",
          name: "Agent (Find RefreshTokenRepository implementation)",
          startTime: "2026-03-20 07:15:02.225",
          endTime: "2026-03-20 07:15:22.721",
          observationType: "AGENT",
        },
        {
          id: "0af07492079065ee",
          node: "",
          step: 0,
          parentObservationId: "4d340d283410dc8e",
          name: "Claude Response (1/2)",
          startTime: "2026-03-20 07:14:54.299",
          endTime: "2026-03-20 07:15:22.723",
          observationType: "GENERATION",
        },
        {
          id: "6df020b6088e85a3",
          node: "",
          step: 0,
          parentObservationId: "243d88bdfdeeb141",
          name: "[Agent 1] Claude Response (1/3)",
          startTime: "2026-03-20 07:15:02.230",
          endTime: "2026-03-20 07:15:06.855",
          observationType: "GENERATION",
        },
        {
          id: "8d5de4922a900bb1",
          node: "",
          step: 0,
          parentObservationId: "4d340d283410dc8e",
          name: "Claude Response (2/2)",
          startTime: "2026-03-20 07:15:22.724",
          endTime: "2026-03-20 07:15:26.873",
          observationType: "GENERATION",
        },
        {
          id: "98890df764c17b4f",
          node: "",
          step: 0,
          parentObservationId: "243d88bdfdeeb141",
          name: "[Agent 1] Claude Response (2/3)",
          startTime: "2026-03-20 07:15:06.856",
          endTime: "2026-03-20 07:15:11.209",
          observationType: "GENERATION",
        },
        {
          id: "d2871cd47802b455",
          node: "",
          step: 0,
          parentObservationId: "243d88bdfdeeb141",
          name: "[Agent 1] Claude Response (3/3)",
          startTime: "2026-03-20 07:15:11.211",
          endTime: "2026-03-20 07:15:22.719",
          observationType: "GENERATION",
        },
        {
          id: "0c3fee151a611af4",
          node: "",
          step: 0,
          parentObservationId: "d2871cd47802b455",
          name: "Here is the full context for `RefreshTokenReposito...",
          startTime: "2026-03-20 07:15:22.719",
          endTime: "2026-03-20 07:15:22.719",
          observationType: "SPAN",
        },
        {
          id: "243d88bdfdeeb141",
          node: "",
          step: 0,
          parentObservationId: "5d3c0830995c7658",
          name: "Agent Turn 1",
          startTime: "2026-03-20 07:15:02.230",
          endTime: "2026-03-20 07:15:22.719",
          observationType: "SPAN",
        },
        {
          id: "44eedbf12b5f0251",
          node: "",
          step: 0,
          parentObservationId: "8d5de4922a900bb1",
          name: "The concrete implementation is in [app/infra/sqlmo...",
          startTime: "2026-03-20 07:15:26.873",
          endTime: "2026-03-20 07:15:26.873",
          observationType: "SPAN",
        },
        {
          id: "4d340d283410dc8e",
          node: "",
          step: 0,
          parentObservationId: null,
          name: "Claude Code - Turn 1",
          startTime: "2026-03-20 07:14:54.299",
          endTime: "2026-03-20 07:15:26.873",
          observationType: "SPAN",
        },
        {
          id: "789621472e571d9f",
          node: "",
          step: 0,
          parentObservationId: "98890df764c17b4f",
          name: "Now let me call the GitNexus context tool for `Ref...",
          startTime: "2026-03-20 07:15:10.913",
          endTime: "2026-03-20 07:15:10.915",
          observationType: "SPAN",
        },
        {
          id: "35d54bd8fae69f24",
          node: "",
          step: 0,
          parentObservationId: "6df020b6088e85a3",
          name: "Tool: ToolSearch",
          startTime: "2026-03-20 07:15:06.852",
          endTime: "2026-03-20 07:15:06.854",
          observationType: "TOOL",
        },
        {
          id: "3f5a0363d2a49f64",
          node: "",
          step: 0,
          parentObservationId: "98890df764c17b4f",
          name: "Tool: gitnexus - context (MCP)",
          startTime: "2026-03-20 07:15:10.915",
          endTime: "2026-03-20 07:15:11.209",
          observationType: "TOOL",
        },
      ];

      const result = buildStepData(observations);
      const userObs = result.filter((obs) => !obs.name.includes("__"));

      // All 13 observations should be present (no EVENTs to filter)
      expect(userObs).toHaveLength(13);

      const findObs = (id: string) => userObs.find((o) => o.id === id);

      const rootSpan = findObs("4d340d283410dc8e")!;
      const gen1 = findObs("0af07492079065ee")!;
      const agent = findObs("5d3c0830995c7658")!;
      const agentTurn = findObs("243d88bdfdeeb141")!;
      const agentGen1 = findObs("6df020b6088e85a3")!;
      const toolSearch = findObs("35d54bd8fae69f24")!;
      const agentGen2 = findObs("98890df764c17b4f")!;
      const gitNexusSpan = findObs("789621472e571d9f")!;
      const gitNexusTool = findObs("3f5a0363d2a49f64")!;
      const agentGen3 = findObs("d2871cd47802b455")!;
      const agentGen3Result = findObs("0c3fee151a611af4")!;
      const gen2 = findObs("8d5de4922a900bb1")!;
      const gen2Result = findObs("44eedbf12b5f0251")!;

      // Verify exact step assignments
      expect(rootSpan.step).toBe(1);
      expect(gen1.step).toBe(2);
      expect(agent.step).toBe(3);
      expect(agentTurn.step).toBe(4);
      expect(agentGen1.step).toBe(5);
      expect(toolSearch.step).toBe(6);
      expect(agentGen2.step).toBe(7);
      expect(gitNexusSpan.step).toBe(8);
      expect(gitNexusTool.step).toBe(8);
      expect(agentGen3.step).toBe(9);
      expect(agentGen3Result.step).toBe(10);
      expect(gen2.step).toBe(11);
      expect(gen2Result.step).toBe(12);
    });
  });
});
