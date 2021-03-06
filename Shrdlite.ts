///<reference path="World.ts"/>
///<reference path="Parser.ts"/>
///<reference path="Interpreter.ts"/>
///<reference path="Planner.ts"/>

window['fn'] = function (state) {
    var temp2 = state.map(function(node) {return _.filter(node.label, function(pddl) {return pddl['rel'] === "at";});});
    return temp2.map(function(obj) {return obj[0].args[1];});
};

window['makeStacks'] = function (ppdlWorld) {
    var stacks = [];
    for (var i=0;i<5;i++) {
        //console.log("i=",i);
        stacks[i] = [];
        var next = "floor-"+i;
        while (next != null) {
            stacks[i].push(next);
            var nextObj = _.find(ppdlWorld, function(ppdl) {
                var obj1 = ppdl['args'][1];
                //console.log("searching object",ppdl);
                return (obj1 == next && (ppdl['rel'] == 'ontop' ||ppdl['rel'] == 'inside'))
            });
            if (nextObj) {
                next = nextObj['args'][0];
                //console.log("next",next);
            } else {
                next = null;
                //console.log("null",next);
            }
        }
    }
    stacks[5] = _.find(ppdlWorld, {'rel':'at'})['args'][1];
    var armHolding = _.find(ppdlWorld, {'rel':'holding'});
    stacks[6] = armHolding ? armHolding['args'][1] : null;
    var lift = _.find(ppdlWorld, {'rel':'dbg-lift'});
    var drop = _.find(ppdlWorld, {'rel':'dbg-drop'});
    stacks[7] = lift ? 'lift' : (drop? 'drop': 'ERRORr');

    var lens = _.map(stacks, function(stack) {
        return (stack && (typeof stack==='object'))? (stack.length || 0) : 0
    });
    var sum = _.reduce(lens, function(a,b){return a+b;});
    stacks['sum'] = sum;

    var severalAttop = _.find(ppdlWorld, {'rel':'dbg-several-attop'});
    if (severalAttop) {
        stacks['severalAttop'] = severalAttop['args'];
    }

    return stacks;

};

module Shrdlite {

    export function interactive(world : World) : void {
        function endlessLoop(utterance : string = "") : void {
            var inputPrompt = "What can I do for you today? ";
            var nextInput = () => world.readUserInput(inputPrompt, endlessLoop);
            if (utterance.trim()) {
                var plan : string[] = splitStringIntoPlan(utterance);
                if (!plan) {
                    plan = parseUtteranceIntoPlan(world, utterance);
                }
                if (plan) {
                    world.printDebugInfo("Plan: " + plan.join(", "));
                    world.performPlan(plan, nextInput);
                    return;
                }
            }
            nextInput();
        }
        world.printWorld(endlessLoop);
    }

    export function parseUtteranceIntoPlan(world : World, utterance : string) : string[] {

        world.printDebugInfo('Parsing utterance: "' + utterance + '"');
        try {
            var parses : Parser.Result[] = Parser.parse(utterance);
        } catch(err) {
            if (err instanceof Parser.Error) {
                world.printError("Parsing error", err.message);
                return;
            } else {
                throw err;
            }
        }
        world.printDebugInfo("Found " + parses.length + " parses");
        parses.forEach((res, n) => {
            world.printDebugInfo("  (" + n + ") " + Parser.parseToString(res));
        });

        var extendedState = extendWorldState(world.currentState);

        try {
            var interpretations : PddlLiteral[][][] = Interpreter.interpret(parses, extendedState);
        } catch(err) {
            if (err instanceof Interpreter.Error) {
                world.printError("Interpretation error", err.message);
                return;
            } else {
                throw err;
            }
        }

        var interpretation : PddlLiteral[][] = interpretations[0];

        world.printDebugInfo("Found " + interpretations.length + " interpretations");
        interpretations.forEach((res, n) => {
            world.printDebugInfo("  (" + n + ") " + Interpreter.interpretationToString(res));
        });


        // Convert from interpretation to plan
        try {
            var plan : string[] = Planner.plan(interpretation, extendedState);
        } catch(err) {
            if (err instanceof Planner.Error) {
                world.printError("Planning error", err.message);
                return;
            } else {
                throw err;
            }
        }

        window['extendedState'] = extendedState;
        window['world'] = world;


        world.printDebugInfo("Final plan: " + plan.join(", "));
        return plan;

    }


    // This is a convenience function that recognizes strings
    // of the form "p r r d l p r d"

    export function splitStringIntoPlan(planstring : string) : string[] {
        var plan : string[] = planstring.trim().split(/\s+/);
        var actions = {p:"pick", d:"drop", l:"left", r:"right"};
        for (var i = plan.length-1; i >= 0; i--) {
            if (!actions[plan[i]]) {
                return;
            }
            plan.splice(i, 0, actions[plan[i]]);
        }
        return plan;
    }
}
