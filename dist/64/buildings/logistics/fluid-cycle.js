export function createFluidCycle(config,total,origin=5,earlyRefill=false){
 const fillDuration=total/config.fillCellsPerSecond;
 const drainDuration=config.drainDuration??2;
 const holdDuration=config.holdDuration??1;
 const emptyDuration=config.emptyDuration??.3;
 const refillDuration=config.refillDuration??2;
 let state='filling',phaseTime=0,elapsed=0,cycle=0,recoveryFrom=.5;
 const level=()=>state==='empty'?0:state==='draining'?Math.max(0,1-phaseTime/drainDuration)
  :state==='recovering'?Math.min(1,recoveryFrom+phaseTime/refillDuration):1;
 const duration=()=>({filling:fillDuration,holding:holdDuration,draining:drainDuration*(earlyRefill?.5:1),
  recovering:(1-recoveryFrom)*refillDuration,empty:emptyDuration}[state]);
 const snapshot=()=>{
  const progress=Math.min(1,phaseTime/duration()),thickness=level(),hasHead=state==='filling';
  return {state,supply:['filling','holding','recovering'].includes(state),thickness,hasHead,
   occupancy:hasHead?progress:thickness>0?1:0,start:origin-1,end:hasHead?origin+total*progress:origin+total+1,
   total,cycle,progress,phaseTime,elapsed,fillDuration,drainDuration,holdDuration,emptyDuration,
   recoveryDuration:(1-recoveryFrom)*refillDuration,earlyRefill};
 };
 const advance=delta=>{
  let remaining=Math.max(0,Number(delta)||0);
  do{
   const step=Math.min(remaining,Math.max(0,duration()-phaseTime));
   phaseTime+=step;elapsed+=step;remaining-=step;
   if(phaseTime+1e-9<duration())break;
   if(state==='filling')state='holding';
   else if(state==='holding')state='draining';
   else if(state==='draining'){
    recoveryFrom=level();
    if(earlyRefill&&recoveryFrom>0){state='recovering';cycle++;}else state='empty';
   }else if(state==='recovering')state='holding';
   else{state='filling';cycle++;}
   phaseTime=0;
  }while(remaining>1e-9);
  return snapshot();
 };
 return {total,snapshot,advance,setEarlyRefill(value){earlyRefill=Boolean(value);return advance(0);},
  seek(time){state='filling';phaseTime=0;elapsed=0;cycle=0;recoveryFrom=.5;return advance(time);}};
}

