import { BelongsTo, HasOne, HasMany, BelongsToMany, Sequelize } from 'sequelize';
import { EventEmitter } from 'node:events';
import { channel } from 'node:diagnostics_channel';

/**
 * @class
 * Extension for Sequelize that allows subscribing to changes on 
 * specific db table entries or to the generic table operations create
 * and delete.
 *
 */

class SequelizeChangeTracker extends EventEmitter {

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

            //console.log( "\n\nModel:", model );

            for ( let association of Object.values( model.associations ) ) {
                //console.log( association, association.source.name, '->', association.target.name)
                if ( association instanceof BelongsTo || association instanceof BelongsToMany ) {
                    //console.log( 'belongs' )
                    const dependingModelList = this.dependingModelMap[ association.source.name ];
                    const dependentModel = association.target.name;
                    if ( ! dependingModelList.includes( dependentModel )) {
                        //console.log( 'add', dependentModel, 'to', dependingModelList )
                        dependingModelList.push( dependentModel );
                    }
                }
                else if ( association instanceof HasOne || association instanceof HasMany ) {
                    //console.log( 'has' )
                    const dependingModelList = this.dependingModelMap[ association.target.name ];
                    const dependentModel = association.source.name;
                    if ( ! dependingModelList.includes( dependentModel )) {
                        //console.log( 'add', dependentModel, 'to', dependingModelList )
                        dependingModelList.push( dependentModel );
                    }
                }
            }

            //this.genericSubscriptions[ modelName ] = ChangeTracker.makeSubObjTemplate();
            this.subscriptionsByResource[ modelName ] = { generic: [] };

            model.addHook(
                'afterFind',
                'yoctopus',
                function( instance, options ) {
                    changeTracker.addSubscriptionIfRequested( modelName, instance, options );
                }
            );

            // https://github.com/sequelize/sequelize/blob/main/src/hooks.js

            model.addHook(
                'afterCreate',
                'yoctopus',
                function( instance, options ) {

                    changeTracker.addSubscriptionIfRequested( modelName, instance, options );

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

                        changeTracker.addSubscriptionIfRequested( modelName, instance, options );

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

                    changeTracker.addSubscriptionIfRequested( modelName, instance, options );

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


    static genericOperations = [ 'create', 'delete' ];


    modelNames = [];

    subscriptionsByResource = {};

    subscriptionsById = {};


    addSubscriptionIfRequested( modelName, instance, options ) {

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

    notifySubscribers({ modelName, operation, changedFields, instanceData }) {

        // we want the values, not the object

        const subscriptionIds = SequelizeChangeTracker.genericOperations.includes( operation )
            ? [ ...this.subscriptionsByResource[ modelName ].generic ]
            : [ ...this.subscriptionsByResource[ modelName ][ instanceData.id ] ];

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


    removeSubscriptionAllModels( subscriptionId ) {
        for ( let subObj of this.subscriptionsById[ subscriptionId ] ) {
            this.removeSubscription( { subscriptionId, ...subObj } );
        }
    }


    findSubscriptionIndices({ subscriptionId, modelName, instanceId, generic }) {

        const sbiIndex = ( this.subscriptionsById[ subscriptionId ] || [] )
            .findIndex( subObj => 
                subObj.modelName === modelName && ( generic === true ? subObj.generic === true : subObj.instanceId === instanceId )
            );

        const modelProp = generic === true ? 'generic' : instanceId;

        const sbrIndex = ( this.subscriptionsByResource[ modelName ][ modelProp ] || [] ).findIndex( id => id === subscriptionId );

        return { sbiIndex, sbrIndex };
    }


    removeSubscription = function({ subscriptionId, modelName, instanceId, generic }) {

        const { sbiIndex, sbrIndex } = this.findSBIIndex({ subscriptionId, modelName, instanceId, generic });

        if ( sbiIndex === -1 || sbrIndex === -1 ) {
            throw new Error( `Can't find subscription ${subscriptionId} on ${modelName} ${instanceId}` );
        }

        this.subscriptionsById[ subscriptionId ].splice( sbiIndex, 1 );

        const modelProp = generic === true ? 'generic' : instanceId;

        this.subscriptionsByResource[ modelName ][ modelProp ].splice( sbrIndex, 1 );
    }


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


    dependingModelMap = {};


}


export default SequelizeChangeTracker;
