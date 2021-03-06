///<reference path="World.ts"/>
///<reference path="Parser.ts"/>
///<reference path="lib/lodash.d.ts"/>

module Interpreter {

    //////////////////////////////////////////////////////////////////////
    // exported functions, classes and interfaces/types

    export function interpret(parses : Parser.Result[], state : ExtendedWorldState) : PddlLiteral[][][] {

        var cmds        : Parser.Command[]    = <Parser.Command[]> _.map(parses, 'prs');
        
        // Handle parsing ambiguity by recursively converting a command object to a string,
        // with parentheses indicating precedence.
        if(cmds.length > 1){
            var promptStr = 'There are multiple ways to interpret that command:\n';
            var cmdToStr = function(obj){
                var str = '';
                if(obj.cmd){
                    str += obj.cmd + ' ';
                }
                if(obj.quant){
                    str += obj.quant + ' ';
                }   
                if(obj.size){
                    str += obj.size + ' ';
                }
                if(obj.color){
                    str += obj.color + ' ';
                }
                if(obj.form){
                    str += obj.form + ' ';
                }
                if(obj.rel){
                    str += obj.rel + ' ';
                }
                if(obj.obj){
                    str += cmdToStr(obj.obj) + ' ';
                }
                if(obj.ent){
                    str += '(' + cmdToStr(obj.ent) + ') ';
                }
                if(obj.loc){
                    str += cmdToStr(obj.loc) + ' ';
                }
                return str;
            };

            for(var c in cmds){
                promptStr += c + '. ' + cmdToStr(cmds[c]) + '\n';
            }
            promptStr += 'Which one did you mean?';
            var selected;
            while(!cmds[selected]){
                selected = Number(prompt(promptStr));
                if(!cmds[selected]){
                    alert("Unfortunately, I didn't quite grasp that. Try again.");
                }
            }
            cmds = [cmds[selected]];
        }

        var intpsPerCmd : PddlLiteral[][][][] = _.map(cmds, function(a) {return interpretCommand(a, state);});
        var intps       : PddlLiteral[][][]   = concat(intpsPerCmd);
        if (intps.length) {
            return intps;
        } else {
            throw new Interpreter.Error("Found no interpretation");
        }
    }

    export function interpretationToString(res : PddlLiteral[][]) : string {
        return res.map((lits) => {
            return lits.map((lit) => literalToString(lit)).join(" & ");
        }).join(" | ");
    }

    export function literalToString(lit : PddlLiteral) : string {
        return (lit.pol ? "" : "-") + lit.rel + "(" + lit.args.join(",") + ")";
    }

    export class Error implements Error {
        public name = "Interpreter.Error";
        constructor(public message? : string) {}
        public toString() {return this.name + ": " + this.message}
    }


    //////////////////////////////////////////////////////////////////////
    // private functions

    function interpretCommand(cmd : Parser.Command, state : ExtendedWorldState) : PddlLiteral[][][] {
        // Outer list: different interpretations
        // Inner list: different conditions for one interpretation, separated by OR.
        //             that is, either of may be true for the interpretation to be satisfied

        //workaround for incorrect command strings
        if(cmd.cmd === 'put'){
            cmd.cmd = 'move';
        }

        var objects   = state.objectsWithId
          , pddlWorld = state.pddlWorld;

        // cmd.cmd: what to do ("move")
        // cmd.ent: what object to do this with (may be undefined, if e.g. "drop")
        // cmd.loc: where to put it (may be undefined, if cmd is e.g. "take")

        var interpretations : PddlLiteral[][][] = [];

        var entitiesIntrprt;
        var resolveAmb = function(intrprt, str1, str2){
            if (intrprt.length > 1) {
                var promptStr = 'Multiple ' + str1 + ' to ' + str2 + ' found:\n';
                for(var i in intrprt){
                    var obj = intrprt[i][0][0];
                    promptStr += i + '. The ' + obj.size + ' ' + obj.color + ' ' + obj.form + '.\n';
                }
                promptStr += 'Which one did you mean?';
                var selected;
                while(!intrprt[selected]){
                    selected = Number(prompt(promptStr));
                    if(!intrprt[selected]){
                        alert("Unfortunately, I didn't quite grasp that. Try again.");
                    }
                }
                intrprt = [intrprt[selected]];
            }
            return intrprt;
        };

        if (cmd.cmd === 'move') {
            // Which entity we should move
            if (cmd.ent) { // Move specified object.
                entitiesIntrprt = findEntities(cmd.ent, objects, pddlWorld.rels);
            }else{ // Move 'it', i.e. the currently held object
                entitiesIntrprt = [[[state.objectsWithId[state.holding]]]];
            }

            // Where we should move it
            var locationsIntrprt = findEntities(cmd.loc.ent, objects, pddlWorld.rels)
            // How entity will be positioned on location (ontop, inside, ...)
                    , rel = cmd.loc.rel;

            // If either is empty, this interpretation is invalid. Return no interpretations
            if (entitiesIntrprt.length === 0 || locationsIntrprt.length === 0) {
                interpretations = [];
            }
            else {
                entitiesIntrprt = resolveAmb(entitiesIntrprt, 'objects', 'move');
                locationsIntrprt = resolveAmb(locationsIntrprt, 'locations', 'move to');

                // Add all possible combinations of interpretations
                interpretations = combineStuff(toIds(entitiesIntrprt), toIds(locationsIntrprt), rel);
            }


        } else if (cmd.cmd === 'take') {
            entitiesIntrprt = findEntities(cmd.ent, objects, pddlWorld.rels);

            // If either is empty, this interpretation is invalid. Return no interpretations
            if (entitiesIntrprt.length === 0) {
                interpretations = [];
            } else {
                entitiesIntrprt = resolveAmb(entitiesIntrprt, 'objects', 'pick up');
                interpretations = combineStuff(toIds(entitiesIntrprt), null, 'holding');
            }
        }

        if(interpretations.length > 1){
            console.log('WARNING - interpretCommand found multiple interpretations.');
        }
        return [pruneImpossibilities(interpretations[0], state)];
    }

    function pruneImpossibilities(interpretation: PddlLiteral[][], 
        state: ExtendedWorldState) : PddlLiteral[][] {

        var legalInterpretation = [];
        for (var i in interpretation) {
            var ontopInside = [], holding = false;
            var legal = true;
            for (var j in interpretation[i]) {
                var literal = interpretation[i][j];
                if (!possibleLiteral(literal, state)) {
                    legal = false;
                    break;
                } else if (literal.pol && (literal.rel === 'ontop' || literal.rel === 'inside')) {
                    if (_.contains(ontopInside, literal.args[1])) {
                        // Many things ontop/inside same thing
                        legal = false;
                        break;
                    } else {
                        ontopInside.push(literal.args[1]);
                    }
                } else if (literal.pol && literal.rel === 'holding') {
                    if (holding) {
                        // Many things in arm
                        legal = false;
                        break;
                    } else {
                        holding = true;
                    }
                }

            }
            if (legal) {
                legalInterpretation.push(interpretation[i]);
            }
        }
        return legalInterpretation;
    }

    function possibleLiteral(literal: PddlLiteral, state: ExtendedWorldState) : boolean {
        if(literal.pol === false){
            return true;
        }

        var obj1 = state.objectsWithId[literal.args[0]];
        // Holding floor
        if(literal.rel === 'holding'){
            return obj1.form !== 'floor';
        }
        // Can not have a binary relation to itself
        if(literal.args[0] === literal.args[1]){
            return false;
        }
        var obj2 = state.objectsWithId[literal.args[1]];
        switch(literal.rel){
            case 'ontop':
                // Things ontop boxes instead of inside
                if(obj2.form === 'box'){
                    return false;
                }
                // Balls ontop non-floor things
                if(obj1.form === 'ball' && obj2.form !== 'floor'){
                    return false;
                }
                // Things ontop balls
                if(obj2.form === 'ball'){
                    return false;
                }
                // Large things ontop small things
                if(obj1.size === 'large' && obj2.size === 'small'){
                    return false;
                }
                // Boxes ontop pyramid
                if(obj1.form === 'box' && obj2.form === 'pyramid'){
                    return false;
                }
                // Small box ontop small brick
                if(obj1.size === 'small' && obj1.form === 'box' 
                    && obj2.size === 'small' && obj2.form === 'brick'){
                    return false;
                }
            break;
            case 'inside':
                // Things inside non-boxes instead of ontop
                if(obj2.form !== 'box'){
                    return false;
                }
                // Large things inside small things
                if(obj1.size === 'large' && obj2.size === 'small'){
                    return false;
                }
                // Pyramid/plank/same size box in box
                if((obj1.form === 'pyramid' || obj1.form === 'plank' 
                    || obj1.form === 'box') && obj1.size === obj2.size){
                    return false;
                }
            break;
            case 'above':
                // Things above balls
                if(obj2.form === 'ball'){
                    return false;
                }
            break;
            case 'under':
                // Balls under things
                if(obj1.form === 'ball'){
                    return false;
                }
                // Under the floor
                if(obj2.form === 'floor'){
                    return false;
                }
            break;
            default:
                return true;
        }
        return true;
    }

    function toIds(objDefs : ObjectDefinitionWithId[][][]) : string[][][] {
        var interpretIds : string[][][] = [];
        for (var i in objDefs) {
            var ors = objDefs[i]
              , orsIds : string[][]= [];
            for (var j in ors) {
                var ands = ors[j]
                  , andsIds : string[] = [];
                for (var k in ands) {
                    andsIds.push(ands[k].id);
                }
                orsIds.push(andsIds);
            }
            interpretIds.push(orsIds);
        }
        return interpretIds;
    }

    // example input: [[1,2,3], ['hej', 'svej'], [6, 7, 8 , 9]]
    export function cartesianProduct<T>(inputArrays: T[][]) : T[][] {
        if (inputArrays.length == 1) {
            var result: T[][] = [];
            for (var i in inputArrays[0]) {
                result.push([inputArrays[0][i]]);
            }
            return result;
        }
        var result: T[][] = [];
        var first = inputArrays.shift();
        var rec = cartesianProduct(inputArrays);
        for (var i in first) {
            for (var j in rec) {
                var newElem = [first[i]].concat(rec[j]);
                result.push(newElem);
            }
        }
        return result;

    }

    // Helper function for interpret command. Takes two 3-dim lists with ids.
    // First list for entities, second for locations. Third argument is the relation between the two.
    // You can send a list as null, in case you don't want a relation with it.
    function combineStuff(entitiesIntrprt: string[][][], locationsIntrprt: string[][][], rel: string) : PddlLiteral[][][] {
        if (entitiesIntrprt == null) {
            entitiesIntrprt = [[[null]]];
        }
        if (locationsIntrprt == null) {
            locationsIntrprt = [[[null]]];
        }
        // For all interpretations...
        var interpretations : PddlLiteral[][][] = [];
        for (var i in entitiesIntrprt) {
            for (var j in locationsIntrprt) {
                var entitiesOr = entitiesIntrprt[i]
                    , locationsOr = locationsIntrprt[j]
                    , interpretationOr: PddlLiteral[][] = [];
                // Separate disjunctions of entities.
                for (var k in entitiesOr) {
                    var entitiesAnd = entitiesOr[k];
                    if (locationsOr.length > 1) {
                        // Combine all entities with a location using cartesian product.
                        // Will return some "impossible" goals in OR, but that's ok.
                        // ... Rules cannot be handled here.
                        var flatLocOr = squishList(locationsOr);
                        var setToProduct: string[][] = [];
                        for (var l in entitiesAnd) {
                            // One dimension in the cartesian product for each entity.
                            setToProduct.push(flatLocOr.slice());
                        }
                        var combinations = cartesianProduct(setToProduct);
                        for (l in combinations) {
                            var combo = combinations[l];
                            var interpretationAnd: PddlLiteral[] = [];
                            for (var m in entitiesAnd) {
                                // Length of combo and entitiesAnd is guaranteed to be same.
                                var arg1 = ((entitiesAnd[m] == null) ? [] : [entitiesAnd[m]]);
                                var arg2 = ((combo[m] == null) ? [] : [combo[m]]);
                                var pddlGoal = { pol: true, rel: rel, args: arg1.concat(arg2) };
                                interpretationAnd.push(pddlGoal);
                            }
                            interpretationOr.push(interpretationAnd);
                        }
                    } else {
                        // Combine all entities with all locations.
                        var interpretationAnd: PddlLiteral[] = [];
                        for (var m in locationsOr[0]) {
                            for (var l in entitiesAnd) {
                                var arg1 = ((entitiesAnd[l] == null) ? [] : [entitiesAnd[l]]);
                                var arg2 = ((locationsOr[0][m] == null) ? [] : [locationsOr[0][m]]);
                                var pddlGoal = { pol: true, rel: rel, args: arg1.concat(arg2) };
                                interpretationAnd.push(pddlGoal);
                            }
                        }
                        interpretationOr.push(interpretationAnd);
                    }
                }
                interpretations.push(interpretationOr);
            }
        }
        return interpretations;
    }

    // Takes a 2-dim list where one of the dimensions only has one element and returns a 1-dim list.
    function squishList(list : string[][]) : string[] { 
        var newList : string[] = [];
        if (list.length == 1) {
            var innerList = list[0];
            for (var i in innerList) {
                newList[i] = innerList[i];
            }
        } else {
            for (var i in list) {
                newList[i] = list[i][0];
            }
        }
        return newList;
    }

    // Finds one/many entities matching the description 'ent' from the parser
    // The outer list is of different interpretations,
    //   (e.g. "the white ball" may find several white balls. => [[[b1]], [[b2]]])
    // The middle list is of several acceptable entities for one interpretation ("the or list")
    //   (e.g. "the floor" should accept all floor tiles. => [[[b1],[b2]]])
    // The inner list is if several entities should be returned for one interpretation
    //   (e.g. "all balls" should select several: [[[b1,b2]]])
    function findEntities(ent : Parser.Entity,
                          objects : { [s: string]: ObjectDefinitionWithId; },
                          ppdlWorld : PddlLiteral[]) : ObjectDefinitionWithId[][][] /* : Parser.Entity[] */ {
        if (ent) {

            //console.log("findEntities()....");

            var critLoc                              = ent.obj.loc || null // entitiy's location (if specified)
              , critObj                              = deleteNullProperties(ent.obj.obj || ent.obj) // description of entity
              , alikeObjs : ObjectDefinitionWithId[] = _.filter(objects, critObj);
            //console.log('obj:', critObj, 'alike objects:', alikeObjs);

            // Location specified for entity? Filter further
            // Note: this has a different type than alikeObjs -
            //       this also accounts for different interpretations of locations
            if (critLoc) {
                var locationsIntrprt = findEntities(critLoc.ent, objects, ppdlWorld)
                  , rel         = critLoc.rel
                    // For each location interpretation, store all objects which has relation to that interpretation's location
                    // Example: "... the box to the left of the two blue balls"
                    // Example world: □1 o1 □2 o2   o3
                  , closeObjsIntrprt : ObjectDefinitionWithId[][] =
                        // for all interpretations...
                        // Example: three blue balls => three combinations/interpretations
                        // [ [[o1,o2]],[[o1,o3]],[[o2,o3]] ]
                      _.map(locationsIntrprt, function (locationsOr) {
                        // ...filter out all objects which...
                        return _.filter(alikeObjs, function (obj) {
                            // ... satisfies at least one ...
                            return _.any(locationsOr, function (locationsAnd) {
                                // ... of the 'and'-lists.
                                // In example: must have relation to both balls
                                return _.all(locationsAnd, function(location) {
                                    return hasBinaryConstraint(ppdlWorld, true, rel, obj, location);
                                });
                            });
                        })
                    });
                   // (Example output: [[□1], [□1], [□1,□2]]
            
                //console.log('close objects:', closeObjsIntrprt);
            }

            // Process quantifiers. (Produce the final obj[][][])
            var quantFilteredObjs : ObjectDefinitionWithId[][][] = [];
            // Has location already given rise to different interpretations?
            if (closeObjsIntrprt) {
                // "the"
                // Select only one object.
                // If several objects match location within an interpretation, create an interpretation for each
                // Example: [[□1], [□1], [□1,□2]] -> [[[□1]], [[□1]], [[□1]] ,[[□2]]]
                // Concat the list, and turn objects into singleton-singleton or-and lists
                if (ent.quant === 'the') {
                    var list = concat(closeObjsIntrprt);
                    quantFilteredObjs = _.map(list, function (i) {
                        return [[i]];
                    });
                }

                // "any"
                // Example: [[□1], [□1], [□1,□2]] -> [[[□1]], [[□1]], [[□1],[□2]]]
                // Create singleton and lists for each object
                else if (ent.quant === 'any') {
                    quantFilteredObjs = _.map(closeObjsIntrprt, function (i) {
                        return _.map(i, function (j) {
                          return [j];
                        });
                    });
                }

                // "all"
                // Select all objects in each interpretation.
                // Example: [[□1], [□1], [□1,□2]] -> [[[□1]], [[□1]], [[□1,□2]]]
                // Create singleton or lists
                else if (ent.quant === 'all') {
                    quantFilteredObjs = _.map(closeObjsIntrprt, function (i) {
                        return [i];
                    });
                }
            }
            // Location was not specified
            else {
                // "The floor" does in fact mean any floor tile
                if ((ent.quant === 'the') && (ent.obj.form === 'floor')) {
                    ent.quant = 'any';
                }

                // "the" should only select one object. May spawn multiple interpretations
                if (ent.quant === 'the') {
                    quantFilteredObjs = _.map(alikeObjs, function (obj) {
                        return [[obj]];
                    });
                    //console.log("the. found other objects!", quantFilteredObjs);
                }

                // "any" can select any object. Has only one interpretation
                else if (ent.quant === 'any') {
                    // Any object is acceptable (Put singleton and lists)
                    var allObjs : ObjectDefinitionWithId[][] = _.map(alikeObjs, function (obj) {
                        return [obj];
                    });
                    // Only one interpretation (singleton outer list)
                    quantFilteredObjs = [allObjs];
                    //console.log("any. found objects!", quantFilteredObjs);
                }

                // "all" selects all objects. Has only one interpretation
                else if (ent.quant === 'all') {
                    quantFilteredObjs = [[alikeObjs]];
                    //console.log("all. found objects!", quantFilteredObjs);
                }
            }

            // Nub the interpretation list (remove duplicates)
            // It doesn't matter which intermediate objects we used to find the object(s)
            // Example: [[[□1]],[[□1]],[[□1],[□2]]] -> [[[□1]],[[□1],[□2]]]
            var nubbedList = _.uniq(quantFilteredObjs, function (i) {
                return JSON.stringify(i); // (convert to string since array comparisons are done by reference)
            });
            //console.log("nubbed list:",nubbedList);

            return nubbedList;
        }
    }


    // Checks if ppdlWorld has some binary constraint
    // (Typically 'inside' or 'ontop')
    function hasBinaryConstraint(ppdlWorld, pol, rel, obj1, obj2) {
        // ... Would like to use _.matches, but it is apparently not deep.
        var found = _.find(ppdlWorld, function (otherRel : PddlLiteral) {
                return otherRel.pol === pol
                    && otherRel.rel == rel
                    && otherRel.args[0]
                    && otherRel.args[0] === obj1.id
                    && otherRel.args[1]
                    && otherRel.args[1] === obj2.id
            });
        return found;
    }



    // Removes all null properties in an object
    function deleteNullProperties(obj) {
        for (var k in obj) {
            if (obj[k] === null || obj[k] === 'anyform') {
                delete obj[k];
            }
        }
        return obj;
    }

}

