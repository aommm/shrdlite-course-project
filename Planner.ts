///<reference path="World.ts"/>
///<reference path="Interpreter.ts"/>
///<reference path="lib/collections.ts"/>
///<reference path="astar/AStar.ts"/>

module Planner {
    //////////////////////////////////////////////////////////////////////
    // exported functions, classes and interfaces/types

    var searchDepth = 10;
    var NUM_STACKS;
    var WORLD_STATE;

    export function plan(interpretation : PddlLiteral[][], currentState : ExtendedWorldState) : string[] {
        var plan : string[] = planInterpretation(interpretation, currentState);
        if (plan) {
            return plan;
        } else {
            throw new Planner.Error("Found no plans");
        }
    }

    export function planToString(res : string[]) : string {
        return res.join(", ");
    }

    export class Error implements Error {
        public name = "Planner.Error";
        constructor(public message? : string) {}
        public toString() {return this.name + ": " + this.message}
    }


    //////////////////////////////////////////////////////////////////////
    // private functions
    function planInterpretation(intprt : PddlLiteral[][], state : ExtendedWorldState) : string[] {
        var plan : string[] = [];

        console.log("planInterpretation()", state);
        
        console.log("goal", intprt);
        
        if(intprt.length === 0) {
            plan.push("This can't be done");
            return plan;
        }
        
        NUM_STACKS = state.stacks.length;
        WORLD_STATE = state;

        // Update world state with 'attop' and 'arm'
        for(var i = 0; i<NUM_STACKS; i++) {
            var obs = state.objStacks[i];
            var obj = state.objStacks[i][obs.length-1];
            if(obs.length > 1) {
                state.pddlWorld.rels.push({pol:true, rel:"attop", args:[obj.id, "floor-"+i]});
            }
        }
        state.pddlWorld.arm = state.arm;
        state.pddlWorld.holding = state.holding;
        state.pddlWorld.stacks = cloneStacks(state.stacks);
        // Add floor
        for(var s in state.pddlWorld.stacks) {
            state.pddlWorld.stacks[s].unshift("floor-"+s);
        }

        var secNode;
        if(state.holding) {
            // Update state with 'holding' (if any)
            state.pddlWorld.holding = state.holding;
            // Try to put down what we're holding

            var secNodeState = putDownObject(state.pddlWorld, state.arm, state);
            
            if (secNodeState) {
                secNode = new AStar.Node(secNodeState, [], Infinity, null, "d" + 1);
            } else {
                console.warn("Second node can't legally drop!");
            }
        } else {
            // Try to lift something
            var secNodeState = liftObject(state.pddlWorld, state.arm);
            if (secNodeState) {
                secNode = new AStar.Node(secNodeState, [], Infinity, null,"p"+1);
            } else {
                console.warn("Second node can't legally pick!");
            }
        }

        //Will hold all the created nodes
        //One of the dimensions is the "layers" of the node generation
        //The other dimension is the nodes within that layer
        var nodes: AStar.Node[][] = [[]];

        // Create initial node
        var startNode:AStar.Node = new AStar.Node(state.pddlWorld, [], Infinity, null);
        getNeighbours(startNode);

        // If an action was possible in the current position, do it
        if (secNode) {
            var eSnd = new AStar.Edge(startNode, secNode, 1);
            startNode.neighbours.push(eSnd);
            getNeighbours(secNode);
        }
        
        var searchResult = AStar.astar(startNode, createGoalFunction(intprt), createHeuristicFunction(intprt));
        
        console.log("Search result:",searchResult);

        for(var s in searchResult) {
            var str = searchResult[s].action; 
            while(str) {
                pushActions(plan, str[0], Number(str[1]));
                str = str.slice(2,str.length);
            }
        }

        //console.log("färdig", startNode);

        if(searchResult.length === 0) {
            plan.push("What you are asking is simply impossible!");
        }

        return plan;
    }

    // Utility function for cloning two lists
    function cloneStacks(oldStacks: string[][]) {
        var stacks = [];
        for(var i in oldStacks) {
            stacks[i] = [];
            for(var j in oldStacks[i]) {
                stacks[i][j] = oldStacks[i][j];
            }
        }
        return stacks;
    }

    function isHolding(world:PddlWorld):boolean {
        return world.holding !== null;
    }

    function pushActions(plan:string[], action:string, times:number) {
        for(var i=0; i<times; i++) {
            plan.push(action);
        }
    }

    // Check if a relation exists in the world
    function relExist(world:PddlLiteral[], rel:PddlLiteral) {
        for(var i in world) {
            if(world[i].rel === rel.rel && 
            world[i].pol === rel.pol && 
            world[i].args[0] === rel.args[0] && 
            world[i].args[1] === rel.args[1]) {
                return true;
            }
        }
        
        return false;
    }

    // Check which relation left has to right
    // (Returns "left", "right", "above" or "below")
    function checkWhichSide(world:PddlWorld, left:string, right:string) {
        
        var leftP=[], rightP=[];
        var stacks = world.stacks;
        
        if(world.holding === left) {
            leftP[0] = world.arm;
        } else if(world.holding === right) {
            rightP[0] = world.arm;
        }
        
        for(var i in stacks) {
            for(var j in stacks[i]) {
                if(stacks[i][j] === left) {
                    leftP[0] = i;
                    leftP[1] = j;
                } else if(stacks[i][j] === right) {
                    rightP[0] = i;
                    rightP[1] = j;
                }
            }
        }
        
        if(leftP[0] < rightP[0]) {
            return "left";
        } else if(leftP[0] > rightP[0]){
            return "right";
        } else {
            if(leftP[1] > rightP[1]) {
                return "above";
            } else {
                return "under";
            }
        }
    }

    // Creates a heuristic function which looks for a specific goal state
    // The heuristic function takes a node and returns a number which measures how close it is to the goal state
    function createHeuristicFunction(goalWorld:PddlLiteral[][]) {
        return function(node:AStar.Node) : number {
            var world  = node.label
              , stacks = world.stacks
              , orList = goalWorld
              , vals : number[][] =
                    _.map(orList, function (andList) {
                        return _.map(andList, function (literal) {
                            var val = 0;

                            if(literal.rel === "ontop" || literal.rel === "inside") {
                                if(relExist(node.label.rels, literal)) {
                                    val = 0;
                                } else {
                                    val = 4*countObjectsOnTop(node.label, literal.args[0]) +
                                        4*countObjectsOnTop(node.label, literal.args[1]) +
                                        xDistance(world, literal.args[0], literal.args[1]);
                                }
                            }

                            else if(literal.rel === "above" || literal.rel === "under") {
                                if(checkWhichSide(world, literal.args[0], literal.args[1]) === literal.rel) {
                                    val = 0;
                                } else {
                                    val = xDistance(world, literal.args[0], literal.args[1]) +
                                        4 * _.min([countObjectsOnTop(node.label, literal.args[0]),
                                            countObjectsOnTop(node.label, literal.args[1])]);
                                }
                            }

                            else if(literal.rel === "left" || literal.rel === "right") {
                                if(checkWhichSide(world, literal.args[0], literal.args[1]) === literal.rel) {
                                    val = 0;
                                } else {
                                    val = xDistance(world, literal.args[0], literal.args[1])+1;
                                }
                            }

                            else if (literal.rel === 'beside') {
                                var obj1 = literal.args[0]
                                  , obj2 = literal.args[1];
                                val = xDistance(world, obj1, obj2) - 1;
                            }
                            
                            else if(literal.rel === 'holding') {
                                val = xDistance(world, literal.args[0], "arm") + countObjectsOnTop(world, literal.args[0]);   
                            }

                            return val;
                        })
                })
              , maxVals : number[] = _.map(vals, function(list) {return _.max(list)}) // only _.max breaks typing
              , minVal  : number   = _.min(maxVals);

            return minVal;

        }

    }

    // Finds the distance across the x axis between two objects
    function xDistance(world : PddlWorld, obj1 : string, obj2 : string) {
        var stacks : string[][] = world.stacks;

        if (obj1 === world.holding || obj1 === 'arm') {
            var obj1Idx = world.arm;
        } else {
            var obj1Idx = _.findIndex(stacks, function (stack) {
                return _.contains(stack, obj1);
            });
        }

        if (obj2 === world.holding || obj2 === 'arm') {
            var obj2Idx = world.arm;
        } else {
            var obj2Idx = _.findIndex(stacks, function (stack) {
                return _.contains(stack, obj2);
            });
        }

        if (obj1Idx === -1 || obj2Idx === -1) {
            console.log("xDistance: object(s) not found!",world, obj1, obj2);
            return 0;
        } else {
            return Math.abs(obj1Idx-obj2Idx);
        }
    }

    // Count the number of objects on top of the given object
    function countObjectsOnTop(world:PddlWorld, obj:string) {
        
        var count = 0;
        
        if(world.holding === obj) {
            return 0;
        }
        
        for(var i in world.stacks) {
            for(var j in world.stacks[i]) {
                if(world.stacks[i][j] === obj) {
                    count = world.stacks[i].length-1-j;
                }
            }
        }
        
        return count;
    }

    // Creates a goal function for a specific goal state
    // The goal function takes a node and returns true or false
    function createGoalFunction(goalWorld:PddlLiteral[][]) {
        return function(node:AStar.Node) {
            var pddlWorld = node.label;
            var world = pddlWorld.rels;
            var done = false;
            // Here begins new code
            for (var i in goalWorld) {
                var conjunction = true;
                for (var j in goalWorld[i]) {
                    var atom = false;
                    // For each 'and', check all rels in world.
                    for (var n in world) {
                        if ((goalWorld[i][j].rel === 'holding' && 
                            goalWorld[i][j].args[0] === pddlWorld.holding) ||
                            world[n].rel === goalWorld[i][j].rel &&
                            world[n].args[0] === goalWorld[i][j].args[0] &&
                            world[n].args[1] === goalWorld[i][j].args[1]) {
                            atom = true;
                            break;
                        }
                    }
                    if (!atom) {
                        conjunction = false;
                        break;
                    }
                }
                if (conjunction) {
                    return true;
                }
            }
            return false;
        }
    }

    // Get the neighbours for a specific node
    export function getNeighbours(oldNode:AStar.Node) {
        var oldNodeWorld  = oldNode.label
            , armPos        = oldNodeWorld.arm;
        for(var j = 0; j<NUM_STACKS; j++) {
            if(armPos != j) {
                var dir  :string = j>armPos ? "r" : "l"
                  , cost :number = Math.abs(armPos-j)
                  , newNodeWorld = moveArm(oldNodeWorld, j);
            
                var newNode = null;
                // We can either -lift- or -putDown-
                if(!isHolding(oldNodeWorld)) {
                    // We can't always lift - not if we lack objects!
                    var newerNodeWorld = liftObject(newNodeWorld, j);
                    if (newerNodeWorld) {
                        newNode = new AStar.Node(newerNodeWorld, [], Infinity, null, dir+cost+"p"+1);
                    } else {
                        //console.warn("breaking the first commandment");
                    }
                } else {
                    // Try to putDown. Will fail if move is illegal
                    var newerNodeWorld = putDownObject(newNodeWorld, j, WORLD_STATE);
                    if (newerNodeWorld) {
                        newNode = new AStar.Node(newerNodeWorld, [], Infinity, null, dir+cost+"d"+1);
                    } else {
                        //console.warn("breakin the laaw");
                    }
                }
            
                // Check if performing action at current column was legal
                if (newNode) {
                    var edge = new AStar.Edge(oldNode, newNode, cost+1);
                    oldNode.neighbours.push(edge); // Note: we don't want a return edge
                }
            }
        }               
    }

    function clonePddlWorld(pddlWorld:PddlWorld):PddlWorld {
        var newWorld: PddlWorld = {rels: [], arm: 0, holding: null, stacks : []}
         ,  world = pddlWorld.rels;

        for(var w in world) {
            newWorld.rels.push({pol: world[w].pol, rel: world[w].rel, args: [world[w].args[0], world[w].args[1]]});
        }

        newWorld.stacks = cloneStacks(pddlWorld.stacks);

        newWorld.arm = pddlWorld.arm;
        newWorld.holding = pddlWorld.holding;

        return newWorld;
    }

    //Moves the arm in the given PddlWorld to the given stack
    //Returns the modified world, does not change the original!
    function moveArm(state:PddlWorld, stack:number):PddlWorld {
        //If you try to move outside the world just ignore it
        if(stack > NUM_STACKS || stack < 0) {
            return state;
        }

        var world:PddlWorld = clonePddlWorld(state);

        world.arm = stack;

        return world;
    }

    //Puts the held object down on the top object on the given stack
    //Takes a list of possible boxes to know if it should be "inside" or "ontop"
    //Returns the modified world, does not change the original!
    function putDownObject(world:PddlWorld, floor: number, state : ExtendedWorldState):PddlWorld {
        var newWorld: PddlWorld = clonePddlWorld(world);

        // Find currently held object
        var object = world.holding;
        if (!object) return null;

        // Find the object on top of the indicated stack. Also remove its 'attop' preicate
        var topObject = "floor-"+floor;
        for(var i in newWorld.rels) {
            if(world.rels[i].rel === "attop" && world.rels[i].args[1] === "floor-"+floor) {
                topObject = world.rels[i].args[0];
                newWorld.rels.splice(i, 1);
                break;
            }
        }
        if (!topObject) return null;

        var objectObj = state.objectsWithId[object];
        var topObjectObj = state.objectsWithId[topObject];

        var objectForm    = objectObj.form
          , topObjectForm = topObjectObj.form;
        var objectSize    = objectObj.size
          , topObjectSize = topObjectObj.size;

        // TODO check if this placement is legal. If not, return null!

        // if object is a ball, and
        // if topObject is not floor or box,
        //   return null
        // TODO; this doesn't work!
        if (objectForm === 'ball' && (topObjectForm !== 'floor' && topObjectForm !== 'box')) {
            //console.log("should return null");
            return null;
        }

        // if topObject is a ball,
        //   return null
        if (topObjectForm === 'ball') {
            return null;
        }

        // if topObject is small and
        // if object is large,
        //   return null
        if(topObjectSize === 'small' && objectSize === 'large') {
            return null;
        }

        // if topObject is a box, and
        // if object is a pyramid, plank or box, and
        // if object and topObject have the same size,
        //   return null
        if(topObjectForm === 'box' && (objectForm === 'pyramid' || objectForm === 'plank' || objectForm === 'box') && (compareSizes(topObjectSize, objectSize) < 1)) {
            return null
        }

        // if topObject is a (small brick) or pyramid, and
        // if object is a small box,
        //   return null
        if((objectForm === 'box' && objectSize === 'small') && (topObjectForm === 'pyramid' || (topObjectForm === 'brick' && topObjectSize === 'small'))) {
            return null;
        }

        // Large boxes cannot be supported by large pyramids.
        // if topObject is a large pyramid, and
        // if object is a large box,
        //   return null
        if((objectForm === 'box' && objectSize === 'large') && topObjectForm === 'pyramid') {
            return null;
        }

        // Determine 'rel' part of the new predicate
        if (topObjectForm === 'box') {
            var rel = "inside";
        } else {
            var rel = "ontop";
        }

        newWorld.holding = null;

        newWorld.rels.push({pol:true, rel:rel, args:[object, topObject]});
        newWorld.rels.push({pol:true, rel:"attop", args:[object, "floor-"+floor]});

        // Add all relations of type beside, above, under, leftof and rightof.
        // If something was beside etc. the previous top object, then it must now
        // be beside the new top object. 
        for(var i in newWorld.rels){
            if(newWorld.rels[i].rel === 'above' || newWorld.rels[i].rel === 'under' || newWorld.rels[i].rel === 'leftof' 
                || newWorld.rels[i].rel === 'rightof' || newWorld.rels[i].rel === 'beside'){

                if(newWorld.rels[i].args[0] === topObjectObj.id){
                    newWorld.rels.push({pol:true, rel:newWorld.rels[i].rel, args:[objectObj.id, newWorld.rels[i].args[1]]});
                }else if(newWorld.rels[i].args[1] === topObjectObj.id){
                    newWorld.rels.push({pol:true, rel:newWorld.rels[i].rel, args:[newWorld.rels[i].args[0], objectObj.id]});
                }
            }
        }
        newWorld.rels.push({pol:true, rel:'above', args:[objectObj.id, topObjectObj.id]});
        newWorld.rels.push({pol:true, rel:'under', args:[topObjectObj.id, objectObj.id]});

        newWorld.stacks[floor].push(object);

        return newWorld;
    }

    // Lifts the object that is on top of the given stack
    // Assumes that the arm is in the right position to do so
    function liftObject(oldWorld:PddlWorld, floor: number):PddlWorld {
        var world:PddlWorld = clonePddlWorld(oldWorld);
        var newWorld: PddlLiteral[] = world.rels; 
        var foundObject : any = false;

        for(var i:number = 0; i<newWorld.length; i++){
            if(newWorld[i].rel === "attop" && newWorld[i].args[1] === "floor-"+floor) {

                var object = newWorld[i].args[0];
                newWorld.splice(i, 1);
                for(var j in newWorld) {
                    if((newWorld[j].rel === "ontop" || newWorld[j].rel === "inside") && world.rels[j].args[0] === object) {
                        var topRel = newWorld.splice(j, 1);
                        if(topRel[0].args[1].indexOf("floor") === -1) {
                            newWorld.push({pol:true, rel:"attop", args:[topRel[0].args[1], "floor-"+floor]});
                        }
                    }
                }
                world.holding = object;
                foundObject = object;
                break;
            }
        }

        if(!foundObject) {
            return null;
        }

        // remove all leftof/rightof, above/under and beside relations of the picked up object
        var newRels = [];
        for(var r in world.rels){
            // if NOT (involving the picked up object AND is one of the spatial relations above)
            if(!((world.rels[r].args[0] === foundObject.id || world.rels[r].args[1] === foundObject.id)
                && (world.rels[r].rel === 'leftof' || world.rels[r].rel === 'rightof' 
                    || world.rels[r].rel === 'above' || world.rels[r].rel === 'under'
                    || world.rels[r].rel === 'beside'))){
                newRels.push(world.rels[r]);
            }
        }
        world.rels = newRels;
        
        world.stacks[floor].pop();
        
        return world;
    }

    function removeLiteral(pddlWorld: PddlWorld, literal:PddlLiteral) {
        var world = pddlWorld.rels;
        for(var i in world) {
            if(literal.rel === world[i].rel && literal.pol === world[i].pol
                && literal.args[0] === world[i].args[0]
                && literal.args[1] === world[i].args[1]){
                world.splice(i, 1);
            }
        }

        return pddlWorld;
    }

    function findBoxes(world: ExtendedWorldState):string[] {
        var boxes = [];
        for(var i in world.objectsWithId) {
            if(world.objectsWithId[i].form === "box") {
                boxes.push(i);
            }
        }
        return boxes;
    }

    function getRandomInt(max) {
        return Math.floor(Math.random() * max);
    }
    
    function compareSizes(size1:string, size2:string) {
        //The are equal size
        if(size1 === size2) {
            return 0;
        //First must be largest
        } else if(size1 === 'large') {
            return 1;
        //Second must be largest
        } else {
            return -1;
        }
    }
}

