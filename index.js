import { BelongsTo, HasOne, HasMany, BelongsToMany, Sequelize, Model } from 'sequelize';
import { EventEmitter } from 'node:events';

/**
 * The name of a Sequelize model
 * @typedef {String} ModelName
 */

/**
 * Generic Universally Unique Identifier
 * @typedef {String} GUID
 */

/**
 * The id of an instance (Sequelize representation of a database table row)
 * @typedef {String} InstanceId
 */

/**
 * The id of a subscription
 * @typedef {String} SubscriptionId
 */

/**
 * Model event about the entire table
 * @typedef {"create"|"delete"} GenericModelOperation
 */

/**
 * Model event about a specific instance
 * @typedef {"update"|"delete"} SpecificModelOperation
 */

/**
 * ModelOperation
 * @typedef {"create"|"update"|"delete"}
 */

/**
 * The name of a Sequelize model
 * @typedef {String} ModelName
 */

/** 
 * Object describing a generic subscription
 * @typedef {Object} GenericSubscriptionObject
 * @property {ModelName} modelName
 * @property {True} generic
 * @property {SubscriptionId} subscriptionId
 */

/** 
 * Object describing a specific subscription
 * @typedef {Object} SpecificSubscriptionObject
 * @property {ModelName} modelName
 * @property {InstanceId} instanceId
 * @property {SubscriptionId} subscriptionId
 */

/**
 * The name of a field in a model
 * @typedef {String} FieldName
 */

/**
 * List of Sequelize models
 * @typedef {Array<Sequelize.Model>} ModelList
 */

/**
 * @class
 * Extension for Sequelize that allows subscribing to changes on 
 * specific db table entries or to the generic table operations create
 * and delete.
 */

class SequelizeChangeTracker extends EventEmitter {

    /**
     * @constructor
     * @param {Object} config 
     * @param {ModelList} config.models - models to enable tracking on
     */

    constructor({ models }) {

        super();

        const changeTracker = this;

        this.modelNames = models.map( m => m.name );

        this.dependingModelMap = this.modelNames.reduce( (dmm, model) => Object.assign( dmm, { [ model ]: [] } ), {} );

        for ( let model of models ) {

            const modelName = model.name;

            // build a model map so we can look up later on if "higher"
            // subscriptions should be taken into account on change
            // of a 'lower' model

            for ( let association of Object.values( model.associations ) ) {
                if ( association instanceof BelongsTo || association instanceof BelongsToMany ) {
                    const dependingModelList = this.dependingModelMap[ association.source.name ];
                    const dependentModel = association.target.name;
                    if ( ! dependingModelList.includes( dependentModel )) {
                        dependingModelList.push( dependentModel );
                    }
                }
                else if ( association instanceof HasOne || association instanceof HasMany ) {
                    const dependingModelList = this.dependingModelMap[ association.target.name ];
                    const dependentModel = association.source.name;
                    if ( ! dependingModelList.includes( dependentModel )) {
                        dependingModelList.push( dependentModel );
                    }
                }
            }


            // create a basic entry in the "subscriptions by resource" register

            this.subscriptionsByResource[ modelName ] = { generic: [] };


            // add hooks for each operation
            // https://github.com/sequelize/sequelize/blob/main/src/hooks.js
            
            model.addHook(
                'afterFind',
                'yoctopus',
                function( instance, options ) {
                    changeTracker.#addSubscriptionIfRequested( modelName, instance, options );
                }
            );

            model.addHook(
                'afterCreate',
                'yoctopus',
                function( instance, options ) {

                    changeTracker.#addSubscriptionIfRequested( modelName, instance, options );

                    changeTracker.notifySubscribers({ 
                        modelName, 
                        operation: 'create', 
                        changedFields: options.fields,
                        instanceData: instance.dataValues
                    });
                }
            );

            model.addHook(
                'afterBulkCreate',
                'yoctopus',
                function( instances, options ) {
                    //console.log( 'after bulk create', options, instances );
                    for ( let instance of instances ) {

                        changeTracker.#addSubscriptionIfRequested( modelName, instance, options );

                        changeTracker.notifySubscribers({ 
                            modelName, 
                            operation: 'create', 
                            changedFields: options.fields,
                            instanceData: instance.dataValues
                        });                
                    }
                }
            );

            model.addHook(
                'afterUpdate',
                'yoctopus',
                function( instance, options ) {

                    changeTracker.#addSubscriptionIfRequested( modelName, instance, options );

                    changeTracker.notifySubscribers({ 
                        modelName, 
                        operation: 'update', 
                        changedFields: options.fields, 
                        instanceData: instance.dataValues,
                    });
                }
            );

            model.addHook(
                'afterBulkUpdate',
                'yoctopus',
                function( options ) {
                    //console.log( 'after bulk update', options )
                    //changeTracker.notifySubscribers( modelName, 'update', options );
                }
            );

            model.addHook(
                'afterDestroy',
                'yoctopus',
                function( instance, options ) {
                    //console.log( 'after destroy', instance, options )
                    changeTracker.notifySubscribers({ 
                        modelName, 
                        operation: 'delete', 
                        changedFields: options.fields, 
                        instanceData: instance.dataValues,
                    });                        }
            );

            model.addHook(
                'afterBulkDestroy',
                'yoctopus',
                function( options ) {
                    //console.log( 'after bulk destroy', options )
                    //changeTracker.notifySubscribers( modelName, 'delete', options );
                }
            );
        }
    }


    /** @type {Array<GenericModelOperation>} */

    static genericOperations = [ 'create', 'delete' ];


    /** @type {Array<SpecificModelOperation>} */

    static specificOperations = [ 'update', 'delete' ];


    /** @type {Array<ModelName>} */

    modelNames = [];


    /**
     * Map (object actually) of models (object value) that depend on the first model (object key) 
     * @type {Object<ModelName,Array<ModelName>>} 
     */

    dependingModelMap = {};


    /**
     * One of two ways in which the class registers subscriptions. 
     * This register is indexed by ModelName+InstanceId, or ModelName+"generic"
     * if the subscription is for generic events
     * @type {Object<ModelName,<InstanceId|"generic",Array<SubscriptionId>>}
     */

    subscriptionsByResource = {};


    /**
     * One of two ways in which the class registers subscriptions.
     * This register is indexed by SubscriptionId
     * @type {Object<SubscriptionId,Array<GenericSubscriptionObject|SpecificSubscriptionObject>}
     */

    subscriptionsById = {};


    /**
     * Check the options object provided with a sequelize model method to check whether
     * a subscription should be added
     * @private
     * @method
     * @param {ModelName} modelName
     * @param {Sequelize.Instance} instance
     * @param {Object} options
     */

    #addSubscriptionIfRequested( modelName, instance, options ) {

        // instance argument can contain one data object, or an array of objects

        if ( ! instance ) {
            //console.debug( 'No instance found' );
            return;
        }

        if ( ! options.trackChanges ) {
            //console.debug( 'No tracking requested' );
            return;
        }

        if ( ! options.trackChanges?.subscriptionId ) {
            throw new Error( 'Missing subscription id' );
        }

        //console.log( 'Change tracking requested' );

        const subscriptionId = options.trackChanges.subscriptionId;

        const iterableInstances = Array.isArray( instance ) ? instance : [ instance ];

        for ( let inst of iterableInstances ) {
            this.addSubscription({ modelName: inst.constructor.name, instanceId: inst.id, subscriptionId });
        }
    }


    /**
     * For some model event (operation) find the relevant subscription ids
     * and emit a 'data-changed' event
     * @method
     * @public
     * @param {Object} operationData
     * @param {ModelName} operationData.modelName
     * @param {ModelOperation} operationData.operation
     * @param {Array<FieldName>} operationData.changedFields
     * @param {Object<String,any>} operationData.instanceData
     */

    notifySubscribers({ modelName, operation, changedFields, instanceData }) {

        // we want the values, not the object
        
        const genericSubIds = SequelizeChangeTracker.genericOperations.includes( operation )
            ? [ ...this.subscriptionsByResource[ modelName ].generic ] 
            : [];

        const specificSubIds = SequelizeChangeTracker.specificOperations.includes( operation )
            ? [ ...( this.subscriptionsByResource[ modelName ][ instanceData.id ] || [] ) ] 
            : [];

        // filter out duplicates
        // they are possible, because delete is a generic and specific event
        
        const subscriptionIds = [ ...new Set( [ ...genericSubIds, ...specificSubIds ] ) ];

        //console.log( 'notif', modelName, operation, changedFields, instanceData, cascade );

        for ( let dependingModel of this.dependingModelMap[ modelName ] ) {
            const foreignKey = `${dependingModel}Id`;                                   // TODO TODO TODO TODO
            const dependingInstanceId = instanceData[ foreignKey ];
            const dependingInstanceSubscriptions = this.subscriptionsByResource[ dependingModel ][ dependingInstanceId ];
            if ( Array.isArray( dependingInstanceSubscriptions ) && dependingInstanceSubscriptions.length > 0 ) {
                subscriptionIds.push( ...dependingInstanceSubscriptions );
            }
        }

        if ( subscriptionIds.length > 0 ) {

            this.emit(
                'data-changed',
                {
                    operation,
                    model: modelName,
                    instance: instanceData,
                    changedFields,
                    subscriptionIds,
                }
            );

        }
    }


    /**
     * Remove all subscriptions for a given subscription id
     * @method
     * @public
     * @param {SubscriptionId} subscriptionId
     */

    removeSubscriptionAllModels( subscriptionId ) {
        for ( let subObj of this.subscriptionsById[ subscriptionId ] ) {
            this.removeSubscription( { subscriptionId, ...subObj } );
        }
    }


    /**
     * Find the indices in both registers of a certain subscription
     * if it exists
     * @method
     * @public
     * @param {GenericSubscriptionObject|SpecificSubscriptionObject} subscriptionObject
     * @returns {Object<string,number>} indices (sbiIndex and sbrIndex are the indices in the register that is indexed by subscriptionId and resourceId respectively)
     */

    findSubscriptionIndices({ subscriptionId, modelName, instanceId, generic }) {

        const sbiIndex = ( this.subscriptionsById[ subscriptionId ] || [] )
            .findIndex( subObj => 
                subObj.modelName === modelName && ( generic === true ? subObj.generic === true : subObj.instanceId === instanceId )
            );

        const modelProp = generic === true ? 'generic' : instanceId;

        const sbrIndex = ( this.subscriptionsByResource[ modelName ][ modelProp ] || [] ).findIndex( id => id === subscriptionId );

        return { sbiIndex, sbrIndex };
    }


    /**
     * Remove a specific subscription from the registers
     * @method
     * @public
     * @param {GenericSubscriptionObject|SpecificSubscriptionObject} subscriptionObject
     */

    removeSubscription = function({ subscriptionId, modelName, instanceId, generic }) {

        const { sbiIndex, sbrIndex } = this.findSBIIndex({ subscriptionId, modelName, instanceId, generic });

        if ( sbiIndex === -1 || sbrIndex === -1 ) {
            throw new Error( `Can't find subscription ${subscriptionId} on ${modelName} ${instanceId}` );
        }

        this.subscriptionsById[ subscriptionId ].splice( sbiIndex, 1 );

        const modelProp = generic === true ? 'generic' : instanceId;

        this.subscriptionsByResource[ modelName ][ modelProp ].splice( sbrIndex, 1 );
    }


    /**
     * Add a subscription to the registers
     * @method
     * @param {SpecificSubscriptionObject|GenericSubscriptionObject}
     */

    addSubscription = function({ modelName, subscriptionId, instanceId }) {

        //console.debug( 'Add subscription on', modelName, instanceId === undefined ? 'generic' : instanceId, 'with id', subscriptionId );

        if ( ! this.modelNames.includes( modelName )) {
            throw new Error( 'Unknown model: ' + modelName );
        }

        const generic = instanceId === undefined ? true : false;

        const { sbiIndex, sbrIndex } = this.findSubscriptionIndices({ subscriptionId, modelName, instanceId, generic });

        if ( sbiIndex !== -1 ) {
            throw new Error( 'Already subscribed' );
        }

        if ( ! this.subscriptionsById[ subscriptionId ] ) {
            this.subscriptionsById[ subscriptionId ] = [];
        }

        if ( generic === true ) {

            this.subscriptionsById[ subscriptionId ].push({
                modelName,
                generic: true
            });

            this.subscriptionsByResource[ modelName ].generic.push( subscriptionId );

        }
        else {

            this.subscriptionsById[ subscriptionId ].push({
                modelName,
                instanceId
            });

            if ( ! Array.isArray( this.subscriptionsByResource[ modelName ][ instanceId ] )) {
                this.subscriptionsByResource[ modelName ][ instanceId ] = [];
            }

            this.subscriptionsByResource[ modelName ][ instanceId ].push( subscriptionId );
        }

        this.emit( 'subscriptions-changed', { subscriptionId, modelName, instanceId, generic });
    }


    destroy() {
        // unlink etc
    }




}


export default SequelizeChangeTracker;
